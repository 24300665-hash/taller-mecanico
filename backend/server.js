require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const sessions = new Map();
const SESSION_COOKIE = 'taller_session';
const allowedRoles = new Set(['ADMINISTRADOR', 'RECEPCIONISTA']);
const vehicleCatalog = require('../frontend/vehicle-catalog');
function canonicalRole(role) {
  const normalizedRole = String(role || '').trim().toUpperCase();
  if (normalizedRole === 'ADMIN' || normalizedRole === 'ADMINISTRADOR') return 'ADMINISTRADOR';
  if (normalizedRole === 'RECEPCION' || normalizedRole === 'RECEPCIONISTA') return 'RECEPCIONISTA';
  return normalizedRole;
}
const uploadDirectory = path.join(__dirname, 'uploads/clientes');
fs.mkdirSync(uploadDirectory, { recursive: true });

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}.${file.mimetype === 'image/jpeg' ? 'jpg' : file.mimetype === 'image/png' ? 'png' : 'webp'}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 20, fieldSize: 12000 },
  fileFilter: (req, file, callback) => {
    const extensions = { 'image/jpeg': /\.jpe?g$/i, 'image/png': /\.png$/i, 'image/webp': /\.webp$/i };
    const extension = path.extname(file.originalname);
    if (!extensions[file.mimetype] || !extensions[file.mimetype].test(extension))
      return callback(new Error('La fotografía debe ser JPG, PNG o WEBP.'));
    callback(null, true);
  },
});

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
});

// La tabla independiente permite asociar varios vehículos a un cliente.
const initializeVehicleTable = async () => {
  await pool.query(`
  CREATE TABLE IF NOT EXISTS cliente_vehiculos (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    cliente_id BIGINT UNSIGNED NOT NULL,
    marca VARCHAR(60) NULL,
    modelo VARCHAR(80) NULL,
    anio SMALLINT UNSIGNED NULL,
    placas VARCHAR(15) NULL,
    color VARCHAR(40) NULL,
    vin CHAR(17) NULL,
    kilometraje INT UNSIGNED NULL,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_cliente_vehiculos_vin (vin),
    KEY ix_cliente_vehiculos_cliente (cliente_id),
    CONSTRAINT fk_cliente_vehiculos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cliente_vehiculo_kilometrajes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      vehiculo_id BIGINT UNSIGNED NOT NULL,
      kilometraje INT UNSIGNED NOT NULL,
      registrado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY ix_vehiculo_kilometrajes_vehiculo_fecha (vehiculo_id, registrado_en),
      CONSTRAINT fk_vehiculo_kilometrajes_vehiculo FOREIGN KEY (vehiculo_id) REFERENCES cliente_vehiculos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
};

function parseVehicles(value) {
  if (!value) return [];
  let vehicles;
  try { vehicles = JSON.parse(value); } catch { throw new Error('Los datos de los vehículos no tienen un formato válido.'); }
  if (!Array.isArray(vehicles) || vehicles.length > 10 || vehicles.some(vehicle => !vehicle || typeof vehicle !== 'object' || Array.isArray(vehicle)))
    throw new Error('Los datos de vehículos no son válidos o superan el máximo de 10 unidades.');
  return vehicles.map(vehicle => ({
    marca: String(vehicle.marca || '').trim(), modelo: String(vehicle.modelo || '').trim(), anio: vehicle.anio === '' || vehicle.anio == null ? null : Number(vehicle.anio),
    placas: String(vehicle.placas || '').trim().toUpperCase(), color: String(vehicle.color || '').trim(),
    vin: String(vehicle.vin || '').trim().toUpperCase(), kilometraje: vehicle.kilometraje === '' || vehicle.kilometraje == null ? null : Number(vehicle.kilometraje)
  })).filter(vehicle => Object.values(vehicle).some(value => value !== '' && value !== null && value !== false));
}

function validateVehicles(vehicles) {
  const currentYear = new Date().getFullYear() + 1;
  if (!vehicles.length) return 'Registra al menos un vehículo para continuar.';
  for (const vehicle of vehicles) {
    if (vehicle.marca.length > 60 || vehicle.modelo.length > 80 || vehicle.placas.length > 15 || vehicle.color.length > 40)
      return 'Revisa los datos del vehículo: uno de los campos excede su longitud permitida.';
    if (!vehicle.marca) return 'Selecciona la marca del vehículo.';
    if (!vehicle.modelo) return 'Selecciona el modelo del vehículo.';
    if (vehicle.anio === null) return 'Selecciona el año del vehículo.';
    if (!vehicle.placas) return 'Escribe las placas del vehículo.';
    if (!vehicle.color) return 'Escribe el color del vehículo.';
    if (!vehicle.vin) return 'Escribe el VIN del vehículo.';
    const knownMake = Object.hasOwn(vehicleCatalog, vehicle.marca);
    if (!knownMake) return 'Selecciona una marca válida del catálogo.';
    if (!vehicleCatalog[vehicle.marca].includes(vehicle.modelo)) return 'El modelo seleccionado no corresponde a la marca indicada.';
    if (vehicle.anio !== null && (!Number.isInteger(vehicle.anio) || vehicle.anio < 1900 || vehicle.anio > currentYear)) return 'El año del vehículo no es válido.';
    if (vehicle.kilometraje !== null && (!Number.isSafeInteger(vehicle.kilometraje) || vehicle.kilometraje < 0 || vehicle.kilometraje > 2000000)) return 'El kilometraje debe ser un número entre 0 y 2,000,000.';
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vehicle.vin)) return 'El VIN debe tener 17 caracteres y no incluir las letras I, O o Q.';
    if (!/^[A-Z0-9 -]{3,15}$/.test(vehicle.placas)) return 'Las placas solo pueden contener letras, números, espacios y guiones.';
  }
  const vins = vehicles.map(vehicle => vehicle.vin).filter(Boolean);
  if (new Set(vins).size !== vins.length) return 'Hay vehículos con el mismo VIN en este registro.';
  return null;
}

// Registrar usuario
app.post('/api/registro', async (req, res) => {
  try {
    const { nombre, email, password } = req.body;
    if (!nombre || !email || !password || password.length < 8)
      return res.status(400).json({ ok: false, mensaje: 'Datos inválidos.' });

    const hash = await bcrypt.hash(password, 10);
    await pool.execute(
      'INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)',
      [nombre, email.trim().toLowerCase(), hash]
    );
    res.json({ ok: true, mensaje: 'Usuario creado.' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ ok: false, mensaje: 'Ese correo ya existe.' });
    console.error(e);
    res.status(500).json({ ok: false, mensaje: 'Error del servidor.' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.execute(
      'SELECT id, nombre, rol, password_hash FROM usuarios WHERE email = ?',
      [(email || '').trim().toLowerCase()]
    );
    const user = rows[0];
    const valido = user && await bcrypt.compare(password || '', user.password_hash);
    if (!valido)
      return res.status(401).json({ ok: false, mensaje: 'Correo o contraseña incorrectos.' });

    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    res.json({ ok: true, usuario: { id: user.id, nombre: user.nombre, rol: canonicalRole(user.rol) } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, mensaje: 'Error del servidor.' });
  }
});

// Restaurar identidad desde sesión y consultar el rol vigente en MySQL.
async function requireAuthorizedClientWriter(req, res, next) {
  const token = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ ok: false, mensaje: 'Inicia sesión para registrar clientes.' });
  }
  try {
    const [users] = await pool.execute('SELECT id, rol FROM usuarios WHERE id = ?', [session.userId]);
    const user = users[0];
    if (!user) return res.status(401).json({ ok: false, mensaje: 'La sesión ya no es válida.' });
    if (!allowedRoles.has(canonicalRole(user.rol)))
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para registrar clientes.' });
    req.authenticatedUser = user;
    next();
  } catch (error) {
    next(error);
  }
}

function validateClient(fields, photo) {
  const required = ['nombre_completo', 'fecha_nacimiento', 'telefono_personal', 'correo_electronico', 'calle', 'colonia', 'municipio', 'estado', 'codigo_postal'];
  for (const name of required) {
    if (typeof fields[name] !== 'string' || !fields[name].trim()) return `El campo ${name.replaceAll('_', ' ')} es obligatorio.`;
  }
  if (!photo) return 'La fotografía del cliente es obligatoria.';
  const limits = { nombre_completo: 150, contacto_alternativo: 120, telefono_personal: 20, telefono_trabajo: 20, correo_electronico: 254, calle: 150, colonia: 100, municipio: 100, estado: 100, codigo_postal: 10 };
  for (const [name, max] of Object.entries(limits)) {
    if (fields[name] !== undefined && typeof fields[name] !== 'string') return `El campo ${name.replaceAll('_', ' ')} no es válido.`;
    if ((fields[name] || '').length > max) return `${name.replaceAll('_', ' ')} no debe exceder ${max} caracteres.`;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.correo_electronico.trim())) return 'Escribe un correo electrónico válido.';
  const phonePattern = /^\+?[0-9 ()-]{7,20}$/;
  for (const name of ['telefono_personal', 'telefono_trabajo']) if (fields[name] && !phonePattern.test(fields[name])) return `El ${name.replaceAll('_', ' ')} no tiene un formato válido.`;
  if (!/^\d{5}$/.test(fields.codigo_postal)) return 'El código postal debe contener 5 dígitos.';
  const birth = new Date(`${fields.fecha_nacimiento}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || birth.toISOString().slice(0, 10) !== fields.fecha_nacimiento || birth > new Date()) return 'La fecha de nacimiento no es válida.';
  if (photo && !['image/jpeg', 'image/png', 'image/webp'].includes(photo.mimetype)) return 'La fotografía debe ser JPG, PNG o WEBP.';
  return null;
}

// Comprobar la firma binaria real para no confiar en MIME ni extensión declarados.
async function hasValidImageSignature(file) {
  if (!file) return true;
  const bytes = await fs.promises.readFile(file.path);
  if (file.mimetype === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.mimetype === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.mimetype === 'image/webp') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  return false;
}

// Crear cliente solo con usuario autenticado y rol autorizado.
app.post('/api/clientes', requireAuthorizedClientWriter, (req, res) => {
  imageUpload.single('fotografia')(req, res, async error => {
    if (error) return res.status(400).json({ ok: false, mensaje: error.code === 'LIMIT_FILE_SIZE' ? 'La fotografía no debe superar 5 MB.' : error.message });
    const fields = req.body;
    const validationError = validateClient(fields, req.file);
    if (validationError) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ ok: false, mensaje: validationError });
    }
    try {
    if (!await hasValidImageSignature(req.file)) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ ok: false, mensaje: 'El archivo seleccionado no es una imagen JPG, PNG o WEBP válida.' });
    }
      let vehicles;
      try { vehicles = parseVehicles(fields.vehiculos); }
      catch (error) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ ok: false, mensaje: error.message });
      }
      const vehicleError = validateVehicles(vehicles);
      if (vehicleError) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ ok: false, mensaje: vehicleError });
      }
      const [existing] = await pool.execute(
        'SELECT id FROM clientes WHERE correo_electronico = ? OR telefono_personal = ? LIMIT 1',
        [fields.correo_electronico.trim().toLowerCase(), fields.telefono_personal.trim()]
      );
      if (existing.length) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(409).json({ ok: false, mensaje: 'Ya existe un cliente con ese correo o teléfono personal.' });
      }
      const vins = vehicles.map(vehicle => vehicle.vin).filter(Boolean);
      if (vins.length) {
        const placeholders = vins.map(() => '?').join(', ');
        const [existingVehicles] = await pool.execute(`SELECT vin FROM cliente_vehiculos WHERE vin IN (${placeholders}) LIMIT 1`, vins);
        if (existingVehicles.length) {
          if (req.file) fs.unlink(req.file.path, () => {});
          return res.status(409).json({ ok: false, mensaje: 'Ya existe un vehículo registrado con ese VIN.' });
        }
      }
      const photoPath = req.file ? path.basename(req.file.filename) : null;
      const connection = await pool.getConnection();
      let result;
      try {
        await connection.beginTransaction();
        [result] = await connection.execute(
        `INSERT INTO clientes
          (nombre_completo, contacto_alternativo, fecha_nacimiento, telefono_personal, telefono_trabajo, correo_electronico, fotografia, calle, colonia, municipio, estado, codigo_postal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [fields.nombre_completo.trim(), (fields.contacto_alternativo || '').trim() || null, fields.fecha_nacimiento, fields.telefono_personal.trim(), (fields.telefono_trabajo || '').trim() || null, fields.correo_electronico.trim().toLowerCase(), photoPath, fields.calle.trim(), fields.colonia.trim(), fields.municipio.trim(), fields.estado.trim(), fields.codigo_postal]
        );
        for (const vehicle of vehicles) {
          const [vehicleResult] = await connection.execute(
          `INSERT INTO cliente_vehiculos (cliente_id, marca, modelo, anio, placas, color, vin, kilometraje)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [result.insertId, vehicle.marca || null, vehicle.modelo || null, vehicle.anio, vehicle.placas || null, vehicle.color || null, vehicle.vin || null, vehicle.kilometraje]
          );
          if (vehicle.kilometraje !== null) await connection.execute(
            'INSERT INTO cliente_vehiculo_kilometrajes (vehiculo_id, kilometraje) VALUES (?, ?)',
            [vehicleResult.insertId, vehicle.kilometraje]
          );
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      res.status(201).json({ ok: true, mensaje: 'Cliente registrado correctamente.', id: result.insertId });
    } catch (dbError) {
      if (req.file) fs.unlink(req.file.path, () => {});
      if (dbError.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, mensaje: dbError.message?.includes('uq_cliente_vehiculos_vin') ? 'Ya existe un vehículo registrado con ese VIN.' : 'Ya existe un cliente con ese correo o teléfono personal.' });
      console.error(dbError);
      res.status(500).json({ ok: false, mensaje: 'No se pudo registrar el cliente.' });
    }
  });
});

app.get('/api/catalogo/vehiculos', requireAuthorizedClientWriter, (req, res) => {
  res.json({ ok: true, marcas: vehicleCatalog, otraMarca: 'Otra', modelosLibres: true });
});

// Listar clientes para el panel autorizado y consultar un cliente seleccionado.
app.get('/api/clientes', requireAuthorizedClientWriter, async (req, res, next) => {
  try {
    const [clients] = await pool.execute(
      `SELECT id, nombre_completo, telefono_personal, correo_electronico, fotografia,
              municipio, estado, creado_en
       FROM clientes ORDER BY creado_en DESC, id DESC`
    );
    res.json({ ok: true, clientes: clients });
  } catch (error) {
    next(error);
  }
});

app.get('/api/clientes/:id', requireAuthorizedClientWriter, async (req, res, next) => {
  const clientId = Number(req.params.id);
  if (!Number.isSafeInteger(clientId) || clientId < 1)
    return res.status(400).json({ ok: false, mensaje: 'El cliente solicitado no es válido.' });
  try {
    const [clients] = await pool.execute(
      `SELECT id, nombre_completo, contacto_alternativo, fecha_nacimiento,
              telefono_personal, telefono_trabajo, correo_electronico, fotografia,
              calle, colonia, municipio, estado, codigo_postal, creado_en
       FROM clientes WHERE id = ? LIMIT 1`,
      [clientId]
    );
    if (!clients.length) return res.status(404).json({ ok: false, mensaje: 'No se encontró ese cliente.' });
    const [vehicles] = await pool.execute(
      `SELECT id, marca, modelo, anio, placas, color, vin, kilometraje, actualizado_en
       FROM cliente_vehiculos WHERE cliente_id = ? ORDER BY id`, [clientId]
    );
    if (vehicles.length) {
      const placeholders = vehicles.map(() => '?').join(', ');
      const [readings] = await pool.execute(
        `SELECT id, vehiculo_id, kilometraje, registrado_en FROM cliente_vehiculo_kilometrajes
         WHERE vehiculo_id IN (${placeholders}) ORDER BY registrado_en DESC, id DESC`,
        vehicles.map(vehicle => vehicle.id)
      );
      const byVehicle = new Map();
      readings.forEach(reading => {
        if (!byVehicle.has(String(reading.vehiculo_id))) byVehicle.set(String(reading.vehiculo_id), []);
        byVehicle.get(String(reading.vehiculo_id)).push(reading);
      });
      vehicles.forEach(vehicle => { vehicle.historial_kilometraje = byVehicle.get(String(vehicle.id)) || []; });
    }
    res.json({ ok: true, cliente: { ...clients[0], vehiculos: vehicles } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/clientes/:id/vehiculos/:vehiculoId/kilometraje', requireAuthorizedClientWriter, async (req, res, next) => {
  const clientId = Number(req.params.id);
  const vehicleId = Number(req.params.vehiculoId);
  const mileage = req.body?.kilometraje;
  if (!Number.isSafeInteger(clientId) || clientId < 1 || !Number.isSafeInteger(vehicleId) || vehicleId < 1)
    return res.status(400).json({ ok: false, mensaje: 'El vehículo solicitado no es válido.' });
  if (!Number.isSafeInteger(mileage) || mileage < 0 || mileage > 2000000)
    return res.status(400).json({ ok: false, mensaje: 'El kilometraje debe ser un número entre 0 y 2,000,000.' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [vehicles] = await connection.execute('SELECT id, kilometraje FROM cliente_vehiculos WHERE id = ? AND cliente_id = ? FOR UPDATE', [vehicleId, clientId]);
    if (!vehicles.length) {
      await connection.rollback();
      return res.status(404).json({ ok: false, mensaje: 'No se encontró ese vehículo para el cliente.' });
    }
    if (vehicles[0].kilometraje !== null && mileage < vehicles[0].kilometraje) {
      await connection.rollback();
      return res.status(400).json({ ok: false, mensaje: 'El nuevo kilometraje no puede ser menor al último registrado.' });
    }
    await connection.execute('UPDATE cliente_vehiculos SET kilometraje = ? WHERE id = ?', [mileage, vehicleId]);
    await connection.execute('INSERT INTO cliente_vehiculo_kilometrajes (vehiculo_id, kilometraje) VALUES (?, ?)', [vehicleId, mileage]);
    await connection.commit();
    res.json({ ok: true, mensaje: 'Kilometraje actualizado correctamente.' });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

app.get('/api/clientes/:id/fotografia', requireAuthorizedClientWriter, async (req, res, next) => {
  const clientId = Number(req.params.id);
  if (!Number.isSafeInteger(clientId) || clientId < 1)
    return res.status(400).json({ ok: false, mensaje: 'El cliente solicitado no es válido.' });
  try {
    const [clients] = await pool.execute('SELECT fotografia FROM clientes WHERE id = ? LIMIT 1', [clientId]);
    const filename = clients[0]?.fotografia;
    if (!filename) return res.status(404).json({ ok: false, mensaje: 'Este cliente no tiene fotografía.' });
    res.sendFile(path.basename(filename), { root: uploadDirectory }, error => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ ok: false, mensaje: 'Error del servidor.' });
});

initializeVehicleTable()
  .then(() => app.listen(process.env.PORT, () => console.log(`Servidor en http://localhost:${process.env.PORT}`)))
  .catch(error => {
    console.error('No se pudo preparar la tabla de vehículos en MySQL.', error.code || '');
    process.exitCode = 1;
  });
