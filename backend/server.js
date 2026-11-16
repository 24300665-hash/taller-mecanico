const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');

// Cargar siempre la configuración junto al backend, aunque Node se inicie desde
// la raíz del proyecto o desde otra carpeta.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DEMO_MODE = process.env.DEMO === 'true';
const mysql = DEMO_MODE ? null : require('mysql2/promise');

const app = express();
app.use(express.json());
const productionFrontend = path.join(__dirname, '../frontend/dist');
const frontendRoot = fs.existsSync(path.join(productionFrontend, 'index.html'))
  ? productionFrontend
  : path.join(__dirname, '../frontend');
app.use(express.static(frontendRoot));

if (DEMO_MODE) {
  const { configureDemo } = require('./demo');
  configureDemo(app, { bcrypt, crypto, path, multer, fs });
  app.get('*splat', (req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, mensaje: `Ruta API DEMO no encontrada: ${req.method} ${req.path}` });
    res.sendFile(path.join(frontendRoot, 'index.html'));
  });
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`TallerPro en MODO DEMO en puerto ${port}.`));
} else {
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
  console.error('Configuración MySQL incompleta. Define DB_HOST, DB_USER, DB_PASSWORD y DB_NAME; DEMO solo se activa con DEMO=true explícito.');
  process.exit(1);
}

const sessions = new Map();
const SESSION_COOKIE = 'taller_session';
const allowedRoles = new Set(['ADMINISTRADOR', 'RECEPCIONISTA']);
const vehicleCatalog = require('../frontend/vehicle-catalog');
const geographyCatalog = require('../frontend/inegi-state-municipality.json');
const postalCodeCatalog = require('./data/sepomex-postal-codes.json');
if (!Array.isArray(geographyCatalog.states) || geographyCatalog.states.length !== 32 || !Array.isArray(geographyCatalog.municipalities))
  throw new Error('El catálogo local de estados y municipios de INEGI no es válido.');
if (geographyCatalog.states.some(state => !/^\d{2}$/.test(state.code) || !state.name)
  || new Set(geographyCatalog.states.map(state => state.code)).size !== 32
  || new Set(geographyCatalog.states.map(state => state.name)).size !== 32)
  throw new Error('El catálogo local de estados de INEGI contiene claves o nombres inválidos.');
const stateCodeByName = new Map(geographyCatalog.states.map(state => [state.name, state.code]));
const municipalityNamesByState = new Map(geographyCatalog.states.map(state => [state.code, new Set()]));
const municipalityKeys = new Set();
for (const municipality of geographyCatalog.municipalities) {
  const names = municipalityNamesByState.get(municipality.stateCode);
  const key = `${municipality.stateCode}${municipality.code}`;
  if (!names || !/^\d{3}$/.test(municipality.code) || !municipality.name || municipalityKeys.has(key))
    throw new Error('El catálogo local de municipios de INEGI contiene datos no válidos.');
  municipalityKeys.add(key);
  names.add(municipality.name);
}
if ([...municipalityNamesByState.values()].some(names => !names.size))
  throw new Error('El catálogo local de INEGI no incluye municipios para todas las entidades.');
if (!postalCodeCatalog.postalCodes || Object.keys(postalCodeCatalog.postalCodes).length < 30000)
  throw new Error('El catálogo local de códigos postales SEPOMEX no es válido.');
function canonicalRole(role) {
  const normalizedRole = String(role || '').trim().toUpperCase();
  if (normalizedRole === 'ADMIN' || normalizedRole === 'ADMINISTRADOR') return 'ADMINISTRADOR';
  if (normalizedRole === 'RECEPCION' || normalizedRole === 'RECEPCIONISTA') return 'RECEPCIONISTA';
  return normalizedRole;
}
const uploadDirectory = path.join(__dirname, 'uploads/clientes');
fs.mkdirSync(uploadDirectory, { recursive: true });
const workshopUploadDirectory = path.join(__dirname, 'uploads/talleres');
fs.mkdirSync(workshopUploadDirectory, { recursive: true });

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

const workshopImageUpload = multer({
  storage: multer.diskStorage({
    destination: workshopUploadDirectory,
    filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}.${file.mimetype === 'image/jpeg' ? 'jpg' : file.mimetype === 'image/png' ? 'png' : 'webp'}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 10, fieldSize: 12000 },
  fileFilter: (req, file, callback) => {
    const extensions = { 'image/jpeg': /\.jpe?g$/i, 'image/png': /\.png$/i, 'image/webp': /\.webp$/i };
    if (!extensions[file.mimetype] || !extensions[file.mimetype].test(path.extname(file.originalname))) return callback(new Error('La fotografía debe ser JPG, PNG o WEBP.'));
    callback(null, true);
  },
});

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
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
  const [vehicleColumns] = await pool.query('SHOW COLUMNS FROM cliente_vehiculos');
  if (!vehicleColumns.some(column => column.Field === 'version')) await pool.query('ALTER TABLE cliente_vehiculos ADD COLUMN version VARCHAR(80) NULL');
  if (!vehicleColumns.some(column => column.Field === 'numero_serie')) await pool.query('ALTER TABLE cliente_vehiculos ADD COLUMN numero_serie VARCHAR(80) NULL');
  if (!vehicleColumns.some(column => column.Field === 'estatus_id')) await pool.query('ALTER TABLE cliente_vehiculos ADD COLUMN estatus_id BIGINT UNSIGNED NULL');
  if (!vehicleColumns.some(column => column.Field === 'eliminado_en')) await pool.query('ALTER TABLE cliente_vehiculos ADD COLUMN eliminado_en TIMESTAMP NULL');
};

async function initializePhaseTwoSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS estatus (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    strvalor VARCHAR(40) NOT NULL,
    strdescripcion VARCHAR(255) NOT NULL,
    disponible TINYINT(1) NOT NULL DEFAULT 1,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY uq_estatus_strvalor (strvalor)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const defaults = [
    ['ACTIVO', 'Registro habilitado para operar.'], ['SUSPENDIDO', 'Registro suspendido temporalmente.'],
    ['ELIMINADO', 'Registro dado de baja lógica; se conserva la información.'],
    ['ACTUALIZADO', 'Se modificaron los datos del registro.'], ['CANCELADO', 'Registro cancelado.']
  ];
  for (const [value, description] of defaults) await pool.execute('INSERT IGNORE INTO estatus (strvalor, strdescripcion) VALUES (?, ?)', [value, description]);
  await pool.query(`CREATE TABLE IF NOT EXISTS historial_estatus (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    entidad VARCHAR(30) NOT NULL,
    entidad_id BIGINT UNSIGNED NOT NULL,
    accion VARCHAR(30) NOT NULL,
    detalle JSON NULL,
    usuario_id BIGINT UNSIGNED NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id), KEY ix_historial_estatus_entidad (entidad, entidad_id, creado_en)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS talleres (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    nombre VARCHAR(150) NOT NULL,
    direccion VARCHAR(255) NOT NULL,
    razon_social VARCHAR(180) NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    rfc VARCHAR(13) NOT NULL,
    correo_contacto VARCHAR(254) NOT NULL,
    fotografia VARCHAR(255) NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_talleres_rfc (rfc)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [clientColumns] = await pool.query('SHOW COLUMNS FROM clientes');
  if (!clientColumns.some(column => column.Field === 'taller_id')) await pool.query('ALTER TABLE clientes ADD COLUMN taller_id BIGINT UNSIGNED NULL');
  if (!clientColumns.some(column => column.Field === 'estatus_id')) await pool.query('ALTER TABLE clientes ADD COLUMN estatus_id BIGINT UNSIGNED NULL');
  if (clientColumns.some(column => column.Field === 'estatus'))
    await pool.query(`UPDATE clientes c JOIN estatus e ON e.strvalor = c.estatus SET c.estatus_id = e.id WHERE c.estatus_id IS NULL`);
  await pool.query(`UPDATE clientes c JOIN estatus e ON e.strvalor = 'ACTIVO' SET c.estatus_id = e.id WHERE c.estatus_id IS NULL`);
  const [clientStatusConstraints] = await pool.execute("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND CONSTRAINT_NAME = 'fk_clientes_estatus'");
  if (!clientStatusConstraints.length) await pool.query('ALTER TABLE clientes ADD CONSTRAINT fk_clientes_estatus FOREIGN KEY (estatus_id) REFERENCES estatus(id) ON UPDATE CASCADE ON DELETE RESTRICT');
  await pool.query('ALTER TABLE clientes MODIFY estatus_id BIGINT UNSIGNED NOT NULL');
  if (clientColumns.some(column => column.Field === 'estatus')) await pool.query('ALTER TABLE clientes DROP COLUMN estatus');
  const [vehicleStatusConstraints] = await pool.execute("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cliente_vehiculos' AND CONSTRAINT_NAME = 'fk_cliente_vehiculos_estatus'");
  if (!vehicleStatusConstraints.length) {
    await pool.query(`UPDATE cliente_vehiculos v JOIN estatus e ON e.strvalor = 'ACTIVO' SET v.estatus_id = e.id WHERE v.estatus_id IS NULL`);
    await pool.query('ALTER TABLE cliente_vehiculos ADD CONSTRAINT fk_cliente_vehiculos_estatus FOREIGN KEY (estatus_id) REFERENCES estatus(id) ON UPDATE CASCADE ON DELETE RESTRICT');
  }
  await pool.query('ALTER TABLE cliente_vehiculos MODIFY estatus_id BIGINT UNSIGNED NOT NULL');
  const [constraints] = await pool.execute("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND CONSTRAINT_NAME = 'fk_clientes_taller'");
  if (!constraints.length) await pool.query('ALTER TABLE clientes ADD CONSTRAINT fk_clientes_taller FOREIGN KEY (taller_id) REFERENCES talleres(id) ON UPDATE CASCADE ON DELETE RESTRICT');
  const [indexes] = await pool.execute("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND INDEX_NAME = 'ix_clientes_taller_nombre'");
  if (!indexes.length) await pool.query('CREATE INDEX ix_clientes_taller_nombre ON clientes (taller_id, nombre_completo, id)');
}

function parseVehicles(value) {
  if (!value) return [];
  let vehicles;
  try { vehicles = JSON.parse(value); } catch { throw new Error('Los datos de los vehículos no tienen un formato válido.'); }
  if (!Array.isArray(vehicles) || vehicles.length > 10 || vehicles.some(vehicle => !vehicle || typeof vehicle !== 'object' || Array.isArray(vehicle)))
    throw new Error('Los datos de vehículos no son válidos o superan el máximo de 10 unidades.');
  return vehicles.map(vehicle => ({
    marca: String(vehicle.marca || '').trim(), modelo: String(vehicle.modelo || '').trim(), anio: vehicle.anio === '' || vehicle.anio == null ? null : Number(vehicle.anio),
    version: String(vehicle.version || '').trim(), placas: String(vehicle.placas || '').trim().toUpperCase().replace(/[\s-]/g, ''), color: String(vehicle.color || '').trim(),
    vin: String(vehicle.vin || '').trim().toUpperCase(), numero_serie: String(vehicle.numero_serie || '').trim().toUpperCase(), kilometraje: vehicle.kilometraje === '' || vehicle.kilometraje == null ? null : Number(vehicle.kilometraje)
  })).filter(vehicle => Object.values(vehicle).some(value => value !== '' && value !== null && value !== false));
}

function validateVehicles(vehicles) {
  const currentYear = new Date().getFullYear() + 1;
  for (const vehicle of vehicles) {
    if (vehicle.marca.length > 60 || vehicle.modelo.length > 80 || vehicle.version.length > 80 || vehicle.placas.length > 15 || vehicle.color.length > 40 || vehicle.numero_serie.length > 80)
      return 'Revisa los datos del vehículo: uno de los campos excede su longitud permitida.';
    if (!vehicle.marca) return 'Selecciona la marca del vehículo.';
    if (!vehicle.modelo) return 'Selecciona el modelo del vehículo.';
    if (!vehicle.version) return 'Escribe la versión del vehículo.';
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
    if (!/^[A-Z0-9]{3,15}$/.test(vehicle.placas)) return 'Las placas deben contener solo letras y números.';
    if (vehicle.numero_serie && !/^[A-Z0-9-]{3,80}$/.test(vehicle.numero_serie)) return 'El número de serie solo puede contener letras, números y guiones.';
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

function requireStatusManager(req, res, next) {
  if (!['ADMINISTRADOR', 'RECEPCIONISTA'].includes(canonicalRole(req.authenticatedUser?.rol))) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para cambiar el estatus.' });
  next();
}

function requireAdministrator(req, res, next) {
  if (canonicalRole(req.authenticatedUser?.rol) !== 'ADMINISTRADOR') return res.status(403).json({ ok: false, mensaje: 'Solo un administrador puede administrar el catálogo de estatus.' });
  next();
}

async function getStatusId(value) {
  const [rows] = await pool.execute('SELECT id FROM estatus WHERE strvalor = ? AND disponible = 1 LIMIT 1', [value]);
  return rows[0]?.id;
}

async function logStatusChange(entity, entityId, action, detail, userId, executor = pool) {
  await executor.execute('INSERT INTO historial_estatus (entidad, entidad_id, accion, detalle, usuario_id) VALUES (?, ?, ?, ?, ?)', [entity, entityId, action, detail ? JSON.stringify(detail) : null, userId || null]);
}

app.get('/api/estatus', requireAuthorizedClientWriter, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT e.id, e.strvalor, e.strdescripcion, e.disponible, e.creado_en, e.actualizado_en,
      (SELECT COUNT(*) FROM clientes c WHERE c.estatus_id = e.id) + (SELECT COUNT(*) FROM cliente_vehiculos v WHERE v.estatus_id = e.id) AS referencias
      FROM estatus e ORDER BY e.id`);
    res.json({ ok: true, estatus: rows });
  } catch (error) { next(error); }
});

app.get('/api/estatus/historial', requireAuthorizedClientWriter, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT h.id, h.entidad, h.entidad_id, h.accion, h.detalle, h.creado_en, u.nombre AS usuario
      FROM historial_estatus h LEFT JOIN usuarios u ON u.id = h.usuario_id ORDER BY h.id DESC LIMIT 100`);
    res.json({ ok: true, cambios: rows });
  } catch (error) { next(error); }
});

app.post('/api/estatus', requireAuthorizedClientWriter, requireAdministrator, async (req, res, next) => {
  const strvalor = String(req.body?.strvalor || '').trim().toUpperCase();
  const strdescripcion = String(req.body?.strdescripcion || '').trim();
  if (!/^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9_ -]{1,39}$/.test(strvalor) || !strdescripcion || strdescripcion.length > 255)
    return res.status(400).json({ ok: false, mensaje: 'Escribe un valor de estatus válido y una descripción de hasta 255 caracteres.' });
  try {
    const [result] = await pool.execute('INSERT INTO estatus (strvalor, strdescripcion) VALUES (?, ?)', [strvalor, strdescripcion]);
    await logStatusChange('ESTATUS', result.insertId, 'INSERTADO', { strvalor, strdescripcion }, req.authenticatedUser.id);
    res.status(201).json({ ok: true, mensaje: 'Estatus creado.', id: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, mensaje: 'Ya existe un estatus con ese valor.' });
    next(error);
  }
});

app.put('/api/estatus/:id', requireAuthorizedClientWriter, requireAdministrator, async (req, res, next) => {
  const id = Number(req.params.id);
  const strvalor = String(req.body?.strvalor || '').trim().toUpperCase();
  const strdescripcion = String(req.body?.strdescripcion || '').trim();
  if (!Number.isSafeInteger(id) || id < 1 || !/^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9_ -]{1,39}$/.test(strvalor) || !strdescripcion || strdescripcion.length > 255)
    return res.status(400).json({ ok: false, mensaje: 'Revisa el valor y la descripción del estatus.' });
  try {
    const [previousRows] = await pool.execute('SELECT strvalor, strdescripcion, disponible FROM estatus WHERE id = ?', [id]);
    if (!previousRows.length) return res.status(404).json({ ok: false, mensaje: 'No se encontró ese estatus.' });
    const disponible = req.body?.disponible === false || req.body?.disponible === 0 ? 0 : 1;
    if (['ACTIVO', 'SUSPENDIDO', 'ELIMINADO'].includes(previousRows[0].strvalor) && (strvalor !== previousRows[0].strvalor || !disponible)) return res.status(400).json({ ok: false, mensaje: 'No se pueden renombrar ni deshabilitar los estatus base.' });
    await pool.execute('UPDATE estatus SET strvalor = ?, strdescripcion = ?, disponible = ? WHERE id = ?', [strvalor, strdescripcion, disponible, id]);
    await logStatusChange('ESTATUS', id, 'ACTUALIZADO', { anterior: previousRows[0], nuevo: { strvalor, strdescripcion, disponible } }, req.authenticatedUser.id);
    res.json({ ok: true, mensaje: 'Estatus actualizado.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, mensaje: 'Ya existe un estatus con ese valor.' });
    next(error);
  }
});

app.delete('/api/estatus/:id', requireAuthorizedClientWriter, requireAdministrator, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ ok: false, mensaje: 'El estatus solicitado no es válido.' });
  try {
    const [rows] = await pool.execute('SELECT strvalor, disponible FROM estatus WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'No se encontró ese estatus.' });
    if (['ACTIVO', 'SUSPENDIDO'].includes(rows[0].strvalor)) return res.status(400).json({ ok: false, mensaje: 'No se pueden eliminar los estatus base.' });
    const [[{ total }]] = await pool.execute('SELECT (SELECT COUNT(*) FROM clientes WHERE estatus_id = ?) + (SELECT COUNT(*) FROM cliente_vehiculos WHERE estatus_id = ?) AS total', [id, id]);
    if (Number(total)) return res.status(409).json({ ok: false, mensaje: 'El estatus está asignado a registros y no se puede deshabilitar.' });
    await pool.execute('UPDATE estatus SET disponible = 0 WHERE id = ?', [id]);
    await logStatusChange('ESTATUS', id, 'BAJA_LOGICA', rows[0], req.authenticatedUser.id);
    res.json({ ok: true, mensaje: 'Estatus deshabilitado; su registro se conserva.' });
  } catch (error) { next(error); }
});

const rfcPattern = /^(?:[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}|[A-ZÑ&]{4}\d{6}[A-Z0-9]{3})$/;

function validateClient(fields, photo, requirePhoto = true) {
  const required = ['nombre_completo', 'fecha_nacimiento', 'telefono_personal', 'correo_electronico', 'calle', 'colonia', 'municipio', 'estado', 'codigo_postal'];
  for (const name of required) {
    if (typeof fields[name] !== 'string' || !fields[name].trim()) return `El campo ${name.replaceAll('_', ' ')} es obligatorio.`;
  }
  if (requirePhoto && !photo) return 'La fotografía del cliente es obligatoria.';
  const limits = { nombre_completo: 150, contacto_alternativo: 120, telefono_personal: 10, telefono_trabajo: 10, correo_electronico: 254, calle: 150, colonia: 100, municipio: 100, estado: 100, codigo_postal: 10 };
  for (const [name, max] of Object.entries(limits)) {
    if (fields[name] !== undefined && typeof fields[name] !== 'string') return `El campo ${name.replaceAll('_', ' ')} no es válido.`;
    if ((fields[name] || '').length > max) return `${name.replaceAll('_', ' ')} no debe exceder ${max} caracteres.`;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.correo_electronico.trim())) return 'Escribe un correo electrónico válido.';
  const phonePattern = /^\d{10}$/;
  for (const name of ['telefono_personal', 'telefono_trabajo']) if (fields[name] && !phonePattern.test(fields[name])) return `El ${name.replaceAll('_', ' ')} debe contener exactamente 10 dígitos.`;
  const stateCode = stateCodeByName.get(fields.estado);
  if (!stateCode) return 'Selecciona un estado válido del catálogo.';
  if (!municipalityNamesByState.get(stateCode)?.has(fields.municipio)) return 'Selecciona un municipio válido para el estado indicado.';
  if (!/^\d{5}$/.test(fields.codigo_postal)) return 'El código postal debe contener exactamente 5 números.';
  if (!/^\d+$/.test(fields.codigo_postal)) return 'El código postal solo puede contener números.';
  const postalMatches = postalCodeCatalog.postalCodes[fields.codigo_postal];
  if (!postalMatches?.some(location => location.state === fields.estado && location.municipality === fields.municipio)) return 'El código postal no corresponde al estado y municipio seleccionados.';
  const birth = new Date(`${fields.fecha_nacimiento}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || birth.toISOString().slice(0, 10) !== fields.fecha_nacimiento || birth > new Date()) return 'La fecha de nacimiento no es válida.';
  if (photo && !['image/jpeg', 'image/png', 'image/webp'].includes(photo.mimetype)) return 'La fotografía debe ser JPG, PNG o WEBP.';
  return null;
}

function validateWorkshop(fields, photo) {
  const required = ['nombre', 'direccion', 'razon_social', 'telefono', 'rfc', 'correo_contacto'];
  for (const name of required) if (typeof fields[name] !== 'string' || !fields[name].trim()) return `El campo ${name.replaceAll('_', ' ')} es obligatorio.`;
  if (!photo) return 'La fotografía del taller es obligatoria.';
  const lengths = { nombre: 150, direccion: 255, razon_social: 180, telefono: 10, rfc: 13, correo_contacto: 254 };
  for (const [name, max] of Object.entries(lengths)) if (fields[name].length > max) return `${name.replaceAll('_', ' ')} no debe exceder ${max} caracteres.`;
  const rfc = fields.rfc.trim().toUpperCase();
  if (!rfcPattern.test(rfc)) return 'El RFC debe tener el formato válido de persona física o moral mexicana.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.correo_contacto.trim())) return 'Escribe un correo de contacto válido.';
  if (!/^\d{10}$/.test(fields.telefono.trim())) return 'El teléfono del taller debe contener exactamente 10 dígitos.';
  if (!photo || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.mimetype)) return 'La fotografía debe ser JPG, PNG o WEBP.';
  return null;
}

app.get('/api/catalogo/codigo-postal/:cp', requireAuthorizedClientWriter, (req, res) => {
  const cp = req.params.cp;
  if (!/^\d{5}$/.test(cp)) return res.status(400).json({ ok: false, mensaje: 'El código postal debe contener exactamente 5 números.' });
  const locations = postalCodeCatalog.postalCodes[cp];
  if (!locations?.length) return res.status(404).json({ ok: false, mensaje: 'No se encontró ese código postal en el catálogo nacional SEPOMEX.' });
  res.json({ ok: true, codigo_postal: cp, ubicaciones: locations });
});

app.get('/api/talleres', requireAuthorizedClientWriter, async (req, res, next) => {
  try {
    const [workshops] = await pool.execute('SELECT id, nombre, razon_social, rfc FROM talleres ORDER BY nombre ASC, id ASC');
    res.json({ ok: true, talleres: workshops });
  } catch (error) { next(error); }
});

app.post('/api/talleres', requireAuthorizedClientWriter, (req, res) => {
  workshopImageUpload.single('fotografia')(req, res, async error => {
    if (error) return res.status(400).json({ ok: false, mensaje: error.code === 'LIMIT_FILE_SIZE' ? 'La fotografía del taller no debe superar 15 MB.' : error.message });
    const fields = req.body;
    const validationError = validateWorkshop(fields, req.file);
    if (validationError) { if (req.file) fs.unlink(req.file.path, () => {}); return res.status(400).json({ ok: false, mensaje: validationError }); }
    if (!await hasValidImageSignature(req.file)) { fs.unlink(req.file.path, () => {}); return res.status(400).json({ ok: false, mensaje: 'El archivo seleccionado no es una imagen JPG, PNG o WEBP válida.' }); }
    try {
      const rfc = fields.rfc.trim().toUpperCase();
      const [existing] = await pool.execute('SELECT id FROM talleres WHERE rfc = ? LIMIT 1', [rfc]);
      if (existing.length) { fs.unlink(req.file.path, () => {}); return res.status(409).json({ ok: false, mensaje: 'Ya existe un taller registrado con ese RFC.' }); }
      const [result] = await pool.execute('INSERT INTO talleres (nombre, direccion, razon_social, telefono, rfc, correo_contacto, fotografia) VALUES (?, ?, ?, ?, ?, ?, ?)', [fields.nombre.trim(), fields.direccion.trim(), fields.razon_social.trim(), fields.telefono.trim(), rfc, fields.correo_contacto.trim().toLowerCase(), path.basename(req.file.filename)]);
      res.status(201).json({ ok: true, mensaje: 'Taller registrado correctamente.', id: result.insertId });
    } catch (dbError) {
      fs.unlink(req.file.path, () => {});
      if (dbError.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, mensaje: 'Ya existe un taller registrado con ese RFC.' });
      next(dbError);
    }
  });
});

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
      const workshopId = Number(fields.taller_id);
      if (!Number.isSafeInteger(workshopId) || workshopId < 1) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ ok: false, mensaje: 'Selecciona un taller válido.' });
      }
      const [workshop] = await pool.execute('SELECT id FROM talleres WHERE id = ? LIMIT 1', [workshopId]);
      if (!workshop.length) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ ok: false, mensaje: 'El taller seleccionado no existe.' });
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
      const activeStatusId = await getStatusId('ACTIVO');
      if (!activeStatusId) throw new Error('El estatus ACTIVO no está disponible.');
      const connection = await pool.getConnection();
      let result;
      try {
        await connection.beginTransaction();
        [result] = await connection.execute(
        `INSERT INTO clientes
          (nombre_completo, contacto_alternativo, fecha_nacimiento, telefono_personal, telefono_trabajo, correo_electronico, fotografia, calle, colonia, municipio, estado, codigo_postal, taller_id, estatus_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [fields.nombre_completo.trim(), (fields.contacto_alternativo || '').trim() || null, fields.fecha_nacimiento, fields.telefono_personal.trim(), (fields.telefono_trabajo || '').trim() || null, fields.correo_electronico.trim().toLowerCase(), photoPath, fields.calle.trim(), fields.colonia.trim(), fields.municipio.trim(), fields.estado.trim(), fields.codigo_postal, workshopId, activeStatusId]
        );
        for (const vehicle of vehicles) {
          const [vehicleResult] = await connection.execute(
          `INSERT INTO cliente_vehiculos (cliente_id, marca, modelo, anio, version, placas, color, vin, numero_serie, kilometraje, estatus_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [result.insertId, vehicle.marca || null, vehicle.modelo || null, vehicle.anio, vehicle.version || null, vehicle.placas || null, vehicle.color || null, vehicle.vin || null, vehicle.numero_serie || null, vehicle.kilometraje, activeStatusId]
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

app.put('/api/clientes/:id', requireAuthorizedClientWriter, (req, res) => {
  imageUpload.single('fotografia')(req, res, async error => {
    if (error) return res.status(400).json({ ok: false, mensaje: error.code === 'LIMIT_FILE_SIZE' ? 'La fotografía no debe superar 5 MB.' : error.message });
    const id = Number(req.params.id);
    const fields = req.body;
    if (!Number.isSafeInteger(id) || id < 1) { if (req.file) fs.unlink(req.file.path, () => {}); return res.status(400).json({ ok: false, mensaje: 'El cliente solicitado no es válido.' }); }
    const validationError = validateClient(fields, req.file, false);
    if (validationError) { if (req.file) fs.unlink(req.file.path, () => {}); return res.status(400).json({ ok: false, mensaje: validationError }); }
    try {
      if (req.file && !await hasValidImageSignature(req.file)) { fs.unlink(req.file.path, () => {}); return res.status(400).json({ ok: false, mensaje: 'El archivo seleccionado no es una imagen válida.' }); }
      const [currentRows] = await pool.execute('SELECT fotografia FROM clientes WHERE id = ?', [id]);
      if (!currentRows.length) { if (req.file) fs.unlink(req.file.path, () => {}); return res.status(404).json({ ok: false, mensaje: 'No se encontró ese cliente.' }); }
      const photoPath = req.file ? path.basename(req.file.filename) : currentRows[0].fotografia;
      await pool.execute(`UPDATE clientes SET nombre_completo = ?, contacto_alternativo = ?, fecha_nacimiento = ?, telefono_personal = ?, telefono_trabajo = ?, correo_electronico = ?, fotografia = ?, calle = ?, colonia = ?, municipio = ?, estado = ?, codigo_postal = ? WHERE id = ?`, [fields.nombre_completo.trim(), (fields.contacto_alternativo || '').trim() || null, fields.fecha_nacimiento, fields.telefono_personal.trim(), (fields.telefono_trabajo || '').trim() || null, fields.correo_electronico.trim().toLowerCase(), photoPath, fields.calle.trim(), fields.colonia.trim(), fields.municipio.trim(), fields.estado.trim(), fields.codigo_postal, id]);
      await logStatusChange('CLIENTE', id, 'ACTUALIZADO', { accion: 'datos_actualizados' }, req.authenticatedUser.id);
      if (req.file && currentRows[0].fotografia) fs.unlink(path.join(uploadDirectory, path.basename(currentRows[0].fotografia)), () => {});
      res.json({ ok: true, mensaje: 'Cliente actualizado correctamente.' });
    } catch (dbError) {
      if (req.file) fs.unlink(req.file.path, () => {});
      if (dbError.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, mensaje: 'Ya existe otro cliente con ese correo o teléfono personal.' });
      next(dbError);
    }
  });
});

app.post('/api/clientes/:id/suspender', requireAuthorizedClientWriter, requireStatusManager, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ ok: false, mensaje: 'El cliente solicitado no es válido.' });
  try {
    const suspendedStatusId = await getStatusId('SUSPENDIDO');
    if (!suspendedStatusId) return res.status(409).json({ ok: false, mensaje: 'El estatus SUSPENDIDO no está disponible.' });
    const [result] = await pool.execute('UPDATE clientes SET estatus_id = ? WHERE id = ? AND estatus_id <> ?', [suspendedStatusId, id, suspendedStatusId]);
    if (!result.affectedRows) {
      const [rows] = await pool.execute('SELECT e.strvalor AS estatus FROM clientes c JOIN estatus e ON e.id = c.estatus_id WHERE c.id = ?', [id]);
      if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'No se encontró ese cliente.' });
      return res.status(409).json({ ok: false, mensaje: 'El cliente ya estaba suspendido o no está activo.' });
    }
    await logStatusChange('CLIENTE', id, 'SUSPENDIDO', null, req.authenticatedUser.id);
    res.json({ ok: true, mensaje: 'Cliente suspendido.' });
  } catch (error) { next(error); }
});

app.post('/api/clientes/:id/activar', requireAuthorizedClientWriter, requireStatusManager, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ ok: false, mensaje: 'El cliente solicitado no es válido.' });
  try {
    const activeStatusId = await getStatusId('ACTIVO');
    const suspendedStatusId = await getStatusId('SUSPENDIDO');
    const [result] = await pool.execute('UPDATE clientes SET estatus_id = ? WHERE id = ? AND estatus_id = ?', [activeStatusId, id, suspendedStatusId]);
    if (!result.affectedRows) {
      const [rows] = await pool.execute('SELECT e.strvalor AS estatus FROM clientes c JOIN estatus e ON e.id = c.estatus_id WHERE c.id = ?', [id]);
      if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'No se encontró ese cliente.' });
      return res.status(400).json({ ok: false, mensaje: 'El cliente ya se encuentra activo.' });
    }
    await logStatusChange('CLIENTE', id, 'ACTIVO', null, req.authenticatedUser.id);
    res.json({ ok: true, mensaje: 'Cliente activado nuevamente.' });
  } catch (error) { next(error); }
});

// Directorio de clientes paginado en MySQL (máximo 10 registros por solicitud).
app.get('/api/clientes', requireAuthorizedClientWriter, async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const workshopId = req.query.taller ? Number(req.query.taller) : null;
    const direction = req.query.orden === 'desc' ? 'DESC' : 'ASC';
    if (req.query.taller && (!Number.isSafeInteger(workshopId) || workshopId < 1)) return res.status(400).json({ ok: false, mensaje: 'El filtro de taller no es válido.' });
    const where = workshopId ? 'WHERE c.taller_id = ?' : '';
    const params = workshopId ? [workshopId] : [];
    const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM clientes c ${where}`, params);
    const [clients] = await pool.execute(
      `SELECT c.id, c.nombre_completo, c.telefono_personal, c.correo_electronico, c.fotografia,
              c.municipio, c.estado, c.codigo_postal, e.strvalor AS estatus, c.taller_id, t.nombre AS taller, c.creado_en
       FROM clientes c LEFT JOIN talleres t ON t.id = c.taller_id JOIN estatus e ON e.id = c.estatus_id ${where}
       ORDER BY c.nombre_completo ${direction}, c.id ASC LIMIT 10 OFFSET ?`, [...params, (page - 1) * 10]
    );
    res.json({ ok: true, clientes: clients, paginacion: { pagina: page, por_pagina: 10, total, paginas: Math.ceil(total / 10) } });
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
      `SELECT c.id, c.nombre_completo, c.contacto_alternativo, c.fecha_nacimiento,
              c.telefono_personal, c.telefono_trabajo, c.correo_electronico, c.fotografia,
              c.calle, c.colonia, c.municipio, c.estado, c.codigo_postal, e.strvalor AS estatus, c.taller_id, t.nombre AS taller, c.creado_en
       FROM clientes c LEFT JOIN talleres t ON t.id = c.taller_id JOIN estatus e ON e.id = c.estatus_id WHERE c.id = ? LIMIT 1`,
      [clientId]
    );
    if (!clients.length) return res.status(404).json({ ok: false, mensaje: 'No se encontró ese cliente.' });
    const [vehicles] = await pool.execute(
      `SELECT v.id, v.marca, v.modelo, v.anio, v.version, v.placas, v.color, v.vin, v.numero_serie, v.kilometraje, v.actualizado_en, e.strvalor AS estatus
       FROM cliente_vehiculos v JOIN estatus e ON e.id = v.estatus_id WHERE v.cliente_id = ? ORDER BY v.id`, [clientId]
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

function clientVehicleIsValid(clientId, res, next) {
  if (!Number.isSafeInteger(clientId) || clientId < 1) {
    res.status(400).json({ ok: false, mensaje: 'Selecciona un cliente válido.' });
    return false;
  }
  return true;
}

app.get('/api/vehiculos', requireAuthorizedClientWriter, async (req, res, next) => {
  const plates = String(req.query.placas || '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (plates && !/^[A-Z0-9]{3,15}$/.test(plates))
    return res.status(400).json({ ok: false, mensaje: 'Las placas deben contener entre 3 y 15 letras o números.' });
  try {
    // Los registros anteriores pueden conservar espacios o guiones; la búsqueda
    // compara la misma versión normalizada que se usa al registrar vehículos nuevos.
    const where = plates ? "WHERE UPPER(REPLACE(REPLACE(v.placas, '-', ''), ' ', '')) = ?" : '';
    const [rows] = await pool.execute(`SELECT v.id, v.cliente_id, v.marca, v.modelo, v.anio, v.version, v.placas, v.color, v.vin, v.numero_serie,
      v.kilometraje, v.actualizado_en, c.nombre_completo AS cliente, c.taller_id, t.nombre AS taller, e.strvalor AS estatus
      FROM cliente_vehiculos v JOIN clientes c ON c.id = v.cliente_id LEFT JOIN talleres t ON t.id = c.taller_id JOIN estatus e ON e.id = v.estatus_id
      ${where} ORDER BY v.id DESC LIMIT 200`, plates ? [plates] : []);
    res.json({ ok: true, vehiculos: rows });
  } catch (error) { next(error); }
});

app.get('/api/vehiculos/clientes-activos', requireAuthorizedClientWriter, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT c.id, c.nombre_completo FROM clientes c JOIN estatus e ON e.id = c.estatus_id
      WHERE e.strvalor = 'ACTIVO' ORDER BY c.nombre_completo, c.id LIMIT 500`);
    res.json({ ok: true, clientes: rows });
  } catch (error) { next(error); }
});

app.post('/api/vehiculos', requireAuthorizedClientWriter, async (req, res, next) => {
  const clientId = Number(req.body?.cliente_id);
  if (!clientVehicleIsValid(clientId, res)) return;
  try {
    const [clients] = await pool.execute(`SELECT c.id FROM clientes c JOIN estatus e ON e.id = c.estatus_id WHERE c.id = ? AND e.strvalor = 'ACTIVO'`, [clientId]);
    if (!clients.length) return res.status(409).json({ ok: false, mensaje: 'Solo se pueden asociar vehículos con clientes activos.' });
    let vehicle;
    try { vehicle = parseVehicles(JSON.stringify([req.body || {}]))[0]; }
    catch (error) { return res.status(400).json({ ok: false, mensaje: error.message }); }
    const activeStatusId = await getStatusId('ACTIVO');
    const vehicleValidation = validateVehicles([vehicle]);
    if (vehicleValidation) return res.status(400).json({ ok: false, mensaje: vehicleValidation });
    if (!activeStatusId) return res.status(409).json({ ok: false, mensaje: 'El estatus ACTIVO no está disponible.' });
    const [result] = await pool.execute(`INSERT INTO cliente_vehiculos (cliente_id, marca, modelo, anio, version, placas, color, vin, numero_serie, kilometraje, estatus_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [clientId, vehicle.marca, vehicle.modelo, vehicle.anio, vehicle.version || null, vehicle.placas, vehicle.color, vehicle.vin, vehicle.numero_serie || null, vehicle.kilometraje, activeStatusId]);
    if (vehicle.kilometraje !== null) await pool.execute('INSERT INTO cliente_vehiculo_kilometrajes (vehiculo_id, kilometraje) VALUES (?, ?)', [result.insertId, vehicle.kilometraje]);
    await logStatusChange('VEHICULO', result.insertId, 'INSERTADO', { cliente_id: clientId, vin: vehicle.vin }, req.authenticatedUser.id);
    res.status(201).json({ ok: true, id: result.insertId, mensaje: 'Vehículo registrado y asociado al cliente.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, mensaje: 'Ese VIN ya está registrado.' });
    next(error);
  }
});

app.put('/api/vehiculos/:id', requireAuthorizedClientWriter, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ ok: false, mensaje: 'El vehículo solicitado no es válido.' });
  let connection;
  try {
    let vehicle;
    try { vehicle = parseVehicles(JSON.stringify([req.body || {}]))[0]; }
    catch (error) { return res.status(400).json({ ok: false, mensaje: error.message }); }
    const validationError = validateVehicles([vehicle]);
    if (validationError) return res.status(400).json({ ok: false, mensaje: validationError });
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [currentRows] = await connection.execute(`SELECT v.cliente_id, v.marca, v.modelo, v.anio, v.version, v.placas, v.color, v.vin, v.numero_serie, v.kilometraje, e.strvalor AS estatus
      FROM cliente_vehiculos v JOIN estatus e ON e.id = v.estatus_id WHERE v.id = ? FOR UPDATE`, [id]);
    if (!currentRows.length) {
      await connection.rollback();
      return res.status(404).json({ ok: false, mensaje: 'No se encontró ese vehículo.' });
    }
    if (currentRows[0].estatus !== 'ACTIVO') {
      await connection.rollback();
      return res.status(409).json({ ok: false, mensaje: 'Solo se pueden actualizar vehículos activos.' });
    }
    const [owner] = await connection.execute(`SELECT c.id FROM clientes c JOIN estatus e ON e.id = c.estatus_id WHERE c.id = ? AND e.strvalor = 'ACTIVO'`, [currentRows[0].cliente_id]);
    if (!owner.length) {
      await connection.rollback();
      return res.status(409).json({ ok: false, mensaje: 'El cliente asociado debe estar activo para actualizar el vehículo.' });
    }
    const current = currentRows[0];
    // La ficha es el estado vigente. No se actualiza ni se elimina información de órdenes cerradas.
    const mileage = vehicle.kilometraje === null ? current.kilometraje : vehicle.kilometraje;
    if (current.kilometraje !== null && mileage !== null && mileage < current.kilometraje) {
      await connection.rollback();
      return res.status(400).json({ ok: false, mensaje: 'El kilometraje no puede ser menor al último registrado.' });
    }
    await connection.execute(`UPDATE cliente_vehiculos SET marca = ?, modelo = ?, anio = ?, version = ?, placas = ?, color = ?, vin = ?, numero_serie = ?, kilometraje = ? WHERE id = ?`, [vehicle.marca, vehicle.modelo, vehicle.anio, vehicle.version || null, vehicle.placas, vehicle.color, vehicle.vin, vehicle.numero_serie || null, mileage, id]);
    if (mileage !== null && mileage !== current.kilometraje)
      await connection.execute('INSERT INTO cliente_vehiculo_kilometrajes (vehiculo_id, kilometraje) VALUES (?, ?)', [id, mileage]);
    const before = { marca: current.marca, modelo: current.modelo, anio: current.anio, version: current.version, placas: current.placas, color: current.color, vin: current.vin, numero_serie: current.numero_serie, kilometraje: current.kilometraje };
    const after = { marca: vehicle.marca, modelo: vehicle.modelo, anio: vehicle.anio, version: vehicle.version || null, placas: vehicle.placas, color: vehicle.color, vin: vehicle.vin, numero_serie: vehicle.numero_serie || null, kilometraje: mileage };
    const changes = Object.fromEntries(Object.keys(after).filter(key => String(before[key] ?? '') !== String(after[key] ?? '')).map(key => [key, { anterior: before[key], nuevo: after[key] }]));
    await logStatusChange('VEHICULO', id, 'ACTUALIZADO', { cambios: changes }, req.authenticatedUser.id, connection);
    await connection.commit();
    res.json({ ok: true, mensaje: 'Vehículo actualizado.' });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, mensaje: 'Ese VIN ya está registrado.' });
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

app.delete('/api/vehiculos/:id', requireAuthorizedClientWriter, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ ok: false, mensaje: 'El vehículo solicitado no es válido.' });
  try {
    const suspendedStatusId = await getStatusId('SUSPENDIDO');
    if (!suspendedStatusId) return res.status(409).json({ ok: false, mensaje: 'El estatus SUSPENDIDO no está disponible.' });
    // Desactivar conserva la ficha y cualquier historial relacionado; no borra ni reescribe órdenes.
    const [result] = await pool.execute(`UPDATE cliente_vehiculos SET estatus_id = ?, eliminado_en = CURRENT_TIMESTAMP WHERE id = ? AND estatus_id <> ?`, [suspendedStatusId, id, suspendedStatusId]);
    if (!result.affectedRows) {
      const [rows] = await pool.execute('SELECT id FROM cliente_vehiculos WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'No se encontró ese vehículo.' });
      return res.status(409).json({ ok: false, mensaje: 'Ese vehículo ya está desactivado.' });
    }
    await logStatusChange('VEHICULO', id, 'DESACTIVADO', null, req.authenticatedUser.id);
    res.json({ ok: true, mensaje: 'Vehículo desactivado; el registro y su historial se conservan.' });
  } catch (error) { next(error); }
});

app.post('/api/vehiculos/:id/reactivar', requireAuthorizedClientWriter, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ ok: false, mensaje: 'El vehículo solicitado no es válido.' });
  try {
    const activeStatusId = await getStatusId('ACTIVO');
    if (!activeStatusId) return res.status(409).json({ ok: false, mensaje: 'El estatus ACTIVO no está disponible.' });
    const [result] = await pool.execute(`UPDATE cliente_vehiculos SET estatus_id = ?, eliminado_en = NULL WHERE id = ? AND estatus_id <> ?`, [activeStatusId, id, activeStatusId]);
    if (!result.affectedRows) {
      const [rows] = await pool.execute('SELECT id FROM cliente_vehiculos WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'No se encontró ese vehículo.' });
      return res.status(409).json({ ok: false, mensaje: 'Ese vehículo ya está activo.' });
    }
    await logStatusChange('VEHICULO', id, 'REACTIVADO', null, req.authenticatedUser.id);
    res.json({ ok: true, mensaje: 'Vehículo reactivado correctamente.' });
  } catch (error) { next(error); }
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

app.get('*splat', (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, mensaje: `Ruta API no encontrada: ${req.method} ${req.path}` });
  res.sendFile(path.join(frontendRoot, 'index.html'));
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ ok: false, mensaje: 'Error del servidor.' });
});

initializeVehicleTable().then(initializePhaseTwoSchema)
  .then(() => {
    const port = Number(process.env.PORT || 3000);
    app.listen(port, '0.0.0.0', () => console.log(`Servidor en http://0.0.0.0:${port}`));
  })
  .catch(error => {
    console.error('No se pudo preparar la tabla de vehículos en MySQL.', error.code || '');
    process.exitCode = 1;
  });
}
