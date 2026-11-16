const crypto = require('crypto');

const DEMO_ACCOUNT = Object.freeze({
  id: 1,
  nombre: 'Administración DEMO',
  email: 'demo@tallerpro.local',
  password: 'DemoTallerPro2026!',
  rol: 'ADMINISTRADOR',
});

function configureDemo(app, { bcrypt, path, multer, fs }) {
  const sessions = new Map();
  const uploads = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 30 } });
  const workshopUploads = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 10 } });
  const stateData = require('../frontend/inegi-state-municipality.json');
  const vehicleCatalog = require('../frontend/vehicle-catalog');
  const states = new Map(stateData.states.map(item => [item.name, item.code]));
  const municipalities = new Map(stateData.states.map(item => [item.code, new Set()]));
  stateData.municipalities.forEach(item => municipalities.get(item.stateCode)?.add(item.name));
  const postalCodes = require('./data/sepomex-postal-codes.json').postalCodes;
  const active = { id: 1, strvalor: 'ACTIVO', strdescripcion: 'Registro habilitado para operar.', disponible: 1 };
  const suspended = { id: 2, strvalor: 'SUSPENDIDO', strdescripcion: 'Registro suspendido temporalmente.', disponible: 1 };
  const deleted = { id: 3, strvalor: 'ELIMINADO', strdescripcion: 'Registro dado de baja lógica.', disponible: 1 };
  const db = {
    next: { taller: 2, cliente: 2, vehiculo: 2, status: 6, historial: 2, kilometraje: 2 },
    talleres: [{ id: 1, nombre: 'Taller Demo TallerPro', direccion: 'Av. Ejemplo 100', razon_social: 'TallerPro Demo SA', telefono: '5550000000', rfc: 'DEMO260101AAA', correo_contacto: 'taller@tallerpro.local', fotografia: null }],
    clientes: [{ id: 1, nombre_completo: 'Cliente de demostración', contacto_alternativo: null, fecha_nacimiento: '1990-01-01', telefono_personal: '5550000001', telefono_trabajo: null, correo_electronico: 'cliente@tallerpro.local', fotografia: null, calle: 'Calle Ejemplo 1', colonia: 'Centro', municipio: 'Cuauhtémoc', estado: 'Ciudad de México', codigo_postal: '06000', taller_id: 1, estatus: 'ACTIVO', creado_en: new Date().toISOString() }],
    vehiculos: [{ id: 1, cliente_id: 1, marca: 'Nissan', modelo: 'Versa', anio: 2022, version: 'Advance', placas: 'DEMO123', color: 'Gris', vin: '3N1CN7AP0NL800001', numero_serie: null, kilometraje: 25000, estatus: 'ACTIVO', actualizado_en: new Date().toISOString(), historial_kilometraje: [{ id: 1, kilometraje: 25000, registrado_en: new Date().toISOString() }] }],
    estatus: [active, suspended, deleted, { id: 4, strvalor: 'ACTUALIZADO', strdescripcion: 'Registro modificado.', disponible: 1 }, { id: 5, strvalor: 'CANCELADO', strdescripcion: 'Registro cancelado.', disponible: 1 }],
    historial: [{ id: 1, entidad: 'DEMO', entidad_id: 1, accion: 'INICIALIZADO', detalle: { nota: 'Datos ficticios de ejemplo' }, usuario: DEMO_ACCOUNT.nombre, creado_en: new Date().toISOString() }],
  };
  const passwordHash = bcrypt.hashSync(DEMO_ACCOUNT.password, 10);
  const json = (res, status, body) => res.status(status).json(body);
  const fail = (res, status, mensaje) => json(res, status, { ok: false, mensaje });
  const recordHistory = (entidad, entidad_id, accion, detalle, user = DEMO_ACCOUNT.nombre) => {
    db.historial.unshift({ id: db.next.historial++, entidad, entidad_id, accion, detalle: detalle || null, usuario: user, creado_en: new Date().toISOString() });
  };
  const sessionUser = req => {
    const token = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('taller_session='))?.slice('taller_session='.length);
    const session = token && sessions.get(token);
    if (!session || session.expiresAt < Date.now()) { if (token) sessions.delete(token); return null; }
    return session.user;
  };
  const auth = (req, res, next) => {
    const user = sessionUser(req);
    if (!user) return fail(res, 401, 'Inicia sesión para continuar.');
    req.authenticatedUser = user;
    next();
  };
  const admin = (req, res, next) => req.authenticatedUser.rol === 'ADMINISTRADOR' ? next() : fail(res, 403, 'Solo un administrador puede realizar esta operación.');
  const photoData = file => file ? `data:${file.mimetype};base64,${file.buffer.toString('base64')}` : null;
  const fileSignatureValid = file => {
    if (!file) return true;
    const b = file.buffer;
    if (file.mimetype === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    if (file.mimetype === 'image/png') return b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    return file.mimetype === 'image/webp' && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
  };
  const validateAddress = fields => {
    const stateCode = states.get(fields.estado);
    if (!stateCode || !municipalities.get(stateCode)?.has(fields.municipio)) return 'Selecciona un estado y municipio válidos.';
    if (!/^\d{5}$/.test(fields.codigo_postal || '')) return 'El código postal debe contener cinco dígitos.';
    if (!postalCodes[fields.codigo_postal]?.some(item => item.state === fields.estado && item.municipality === fields.municipio)) return 'El código postal no corresponde al estado y municipio.';
    return null;
  };
  const validateClient = (fields, file, update = false) => {
    const required = ['nombre_completo', 'fecha_nacimiento', 'telefono_personal', 'correo_electronico', 'calle', 'colonia', 'municipio', 'estado', 'codigo_postal'];
    if (required.some(key => !String(fields[key] || '').trim())) return 'Completa todos los datos obligatorios del cliente.';
    if (!update && !file) return 'La fotografía ficticia o seleccionada del cliente es obligatoria en esta operación.';
    if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) || !fileSignatureValid(file))) return 'La imagen debe ser un archivo JPG, PNG o WEBP válido.';
    const limits = { nombre_completo: 150, contacto_alternativo: 120, telefono_personal: 10, telefono_trabajo: 10, correo_electronico: 254, calle: 150, colonia: 100, municipio: 100, estado: 100, codigo_postal: 10 };
    if (Object.entries(limits).some(([key, limit]) => String(fields[key] || '').length > limit)) return 'Uno de los campos del cliente excede su longitud permitida.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.correo_electronico) || !/^\d{10}$/.test(fields.telefono_personal) || (fields.telefono_trabajo && !/^\d{10}$/.test(fields.telefono_trabajo))) return 'Revisa el correo y los teléfonos de 10 dígitos.';
    const birth = new Date(`${fields.fecha_nacimiento}T00:00:00Z`);
    if (Number.isNaN(birth.getTime()) || birth.toISOString().slice(0, 10) !== fields.fecha_nacimiento || birth > new Date()) return 'La fecha de nacimiento no es válida.';
    return validateAddress(fields);
  };
  const validateWorkshop = (fields, file) => {
    if (['nombre', 'direccion', 'razon_social', 'telefono', 'rfc', 'correo_contacto'].some(key => !String(fields[key] || '').trim())) return 'Completa los datos obligatorios del taller.';
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) || !fileSignatureValid(file)) return 'Selecciona una imagen válida para el taller.';
    const limits = { nombre: 150, direccion: 255, razon_social: 180, telefono: 20, rfc: 13, correo_contacto: 254 };
    if (Object.entries(limits).some(([key, limit]) => String(fields[key] || '').length > limit)) return 'Uno de los campos del taller excede su longitud permitida.';
    if (!/^\d{10}$/.test(fields.telefono) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.correo_contacto)) return 'Revisa el teléfono y correo del taller.';
    if (!/^(?:[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}|[A-ZÑ&]{4}\d{6}[A-Z0-9]{3})$/i.test(fields.rfc)) return 'El RFC no tiene un formato válido.';
    return null;
  };
  const parseDemoVehicles = value => {
    let list = [];
    try { list = value ? JSON.parse(value) : []; } catch { throw new Error('Los vehículos no tienen un formato válido.'); }
    if (!Array.isArray(list) || list.length > 10) throw new Error('Se permiten hasta 10 vehículos por cliente.');
    return list.map(item => ({ ...item, marca: String(item.marca || '').trim(), modelo: String(item.modelo || '').trim(), version: String(item.version || '').trim(), placas: String(item.placas || '').toUpperCase().replace(/[\s-]/g, ''), color: String(item.color || '').trim(), vin: String(item.vin || '').trim().toUpperCase(), kilometraje: item.kilometraje === '' || item.kilometraje == null ? null : Number(item.kilometraje) }));
  };
  const validateDemoVehicles = list => {
    for (const vehicle of list) {
      if (!vehicleCatalog[vehicle.marca] || !vehicleCatalog[vehicle.marca].includes(vehicle.modelo)) return 'La marca o modelo no corresponde al catálogo.';
      if (!vehicle.version || !vehicle.anio || !vehicle.placas || !vehicle.color || !/^[A-HJ-NPR-Z0-9]{17}$/.test(vehicle.vin)) return 'Completa los datos obligatorios del vehículo y un VIN válido de 17 caracteres.';
      if (!Number.isInteger(Number(vehicle.anio)) || Number(vehicle.anio) < 1900 || Number(vehicle.anio) > new Date().getFullYear() + 1) return 'El año del vehículo no es válido.';
      if (String(vehicle.marca).length > 60 || String(vehicle.modelo).length > 80 || String(vehicle.version).length > 80 || String(vehicle.color).length > 40 || String(vehicle.numero_serie || '').length > 80) return 'Uno de los campos del vehículo excede su longitud permitida.';
      if (!/^[A-Z0-9]{3,15}$/.test(vehicle.placas)) return 'Las placas deben contener de 3 a 15 letras o números.';
      if (vehicle.numero_serie && !/^[A-Z0-9-]{3,80}$/i.test(vehicle.numero_serie)) return 'El número de serie solo puede contener letras, números y guiones.';
      if (vehicle.kilometraje !== null && (!Number.isSafeInteger(vehicle.kilometraje) || vehicle.kilometraje < 0 || vehicle.kilometraje > 2000000)) return 'El kilometraje no es válido.';
    }
    const vins = list.map(item => item.vin);
    if (new Set(vins).size !== vins.length || vins.some(vin => db.vehiculos.some(item => item.vin === vin))) return 'Ese VIN ya existe en el DEMO.';
    return null;
  };
  const clientView = client => ({ ...client, taller: db.talleres.find(item => item.id === client.taller_id)?.nombre || null });
  const vehicleView = vehicle => {
    const client = db.clientes.find(item => item.id === vehicle.cliente_id);
    return { ...vehicle, cliente: client?.nombre_completo || null, taller_id: client?.taller_id || null, taller: db.talleres.find(item => item.id === client?.taller_id)?.nombre || null };
  };

  app.get('/api/mode', (req, res) => res.json({ ok: true, demo: true, mensaje: 'MODO DEMO: datos ficticios en memoria; se reinician al reiniciar el servidor.' }));
  app.post('/api/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const valid = email === DEMO_ACCOUNT.email && await bcrypt.compare(String(req.body?.password || ''), passwordHash);
    if (!valid) return fail(res, 401, 'Correo o contraseña incorrectos. Usa las credenciales ficticias documentadas.');
    const token = crypto.randomBytes(32).toString('hex');
    const user = { id: DEMO_ACCOUNT.id, nombre: DEMO_ACCOUNT.nombre, rol: DEMO_ACCOUNT.rol };
    sessions.set(token, { user, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
    res.setHeader('Set-Cookie', `taller_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    res.json({ ok: true, usuario: user, demo: true });
  });
  app.post('/api/registro', (req, res) => fail(res, 403, 'El registro de cuentas está deshabilitado en DEMO; utiliza la cuenta ficticia documentada.'));
  app.post('/api/logout', (req, res) => {
    const token = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('taller_session='))?.slice('taller_session='.length);
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', 'taller_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ ok: true });
  });
  app.get('/api/estatus', auth, (req, res) => res.json({ ok: true, estatus: db.estatus.map(item => ({ ...item, referencias: db.clientes.filter(client => client.estatus === item.strvalor).length + db.vehiculos.filter(vehicle => vehicle.estatus === item.strvalor).length })) }));
  app.get('/api/estatus/historial', auth, (req, res) => res.json({ ok: true, cambios: db.historial.slice(0, 100) }));
  app.post('/api/estatus', auth, admin, (req, res) => {
    const strvalor = String(req.body?.strvalor || '').trim().toUpperCase();
    const strdescripcion = String(req.body?.strdescripcion || '').trim();
    if (!/^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9_ -]{1,39}$/.test(strvalor) || !strdescripcion || db.estatus.some(item => item.strvalor === strvalor)) return fail(res, 400, 'El estatus no es válido o ya existe.');
    const item = { id: db.next.status++, strvalor, strdescripcion, disponible: 1 };
    db.estatus.push(item); recordHistory('ESTATUS', item.id, 'INSERTADO', item); res.status(201).json({ ok: true, id: item.id, mensaje: 'Estatus creado en memoria.' });
  });
  app.put('/api/estatus/:id', auth, admin, (req, res) => {
    const item = db.estatus.find(status => status.id === Number(req.params.id));
    if (!item) return fail(res, 404, 'No se encontró ese estatus.');
    if ([active.strvalor, suspended.strvalor, deleted.strvalor].includes(item.strvalor)) return fail(res, 400, 'No se pueden modificar los estatus base.');
    item.strdescripcion = String(req.body?.strdescripcion || '').trim(); item.disponible = req.body?.disponible === false ? 0 : 1;
    recordHistory('ESTATUS', item.id, 'ACTUALIZADO', { strdescripcion: item.strdescripcion }); res.json({ ok: true, mensaje: 'Estatus actualizado en memoria.' });
  });
  app.delete('/api/estatus/:id', auth, admin, (req, res) => {
    const item = db.estatus.find(status => status.id === Number(req.params.id));
    if (!item) return fail(res, 404, 'No se encontró ese estatus.');
    if ([active.strvalor, suspended.strvalor, deleted.strvalor].includes(item.strvalor) || item.referencias) return fail(res, 409, 'No se puede deshabilitar un estatus base o asignado.');
    item.disponible = 0; recordHistory('ESTATUS', item.id, 'BAJA_LOGICA', null); res.json({ ok: true, mensaje: 'Estatus deshabilitado en memoria.' });
  });
  app.get('/api/catalogo/codigo-postal/:cp', auth, (req, res) => {
    if (!/^\d{5}$/.test(req.params.cp)) return fail(res, 400, 'El código postal debe contener cinco dígitos.');
    const ubicaciones = postalCodes[req.params.cp]; if (!ubicaciones?.length) return fail(res, 404, 'No se encontró ese código postal.');
    res.json({ ok: true, codigo_postal: req.params.cp, ubicaciones });
  });
  app.get('/api/catalogo/vehiculos', auth, (req, res) => res.json({ ok: true, marcas: vehicleCatalog, otraMarca: 'Otra', modelosLibres: true }));
  app.get('/api/talleres', auth, (req, res) => res.json({ ok: true, talleres: db.talleres.map(({ id, nombre, razon_social, rfc }) => ({ id, nombre, razon_social, rfc })) }));
  app.post('/api/talleres', auth, (req, res) => workshopUploads.single('fotografia')(req, res, error => {
    if (error) return fail(res, 400, error.code === 'LIMIT_FILE_SIZE' ? 'La fotografía supera 15 MB.' : error.message);
    const fields = req.body || {}; const validation = validateWorkshop(fields, req.file);
    if (validation) return fail(res, 400, validation);
    if (db.talleres.some(item => item.rfc.toUpperCase() === fields.rfc.trim().toUpperCase())) return fail(res, 409, 'Ya existe un taller con ese RFC.');
    const workshop = { id: db.next.taller++, nombre: fields.nombre.trim(), direccion: fields.direccion.trim(), razon_social: fields.razon_social.trim(), telefono: fields.telefono.trim(), rfc: fields.rfc.trim().toUpperCase(), correo_contacto: fields.correo_contacto.trim().toLowerCase(), fotografia: photoData(req.file) };
    db.talleres.push(workshop); recordHistory('TALLER', workshop.id, 'INSERTADO', { nombre: workshop.nombre }); res.status(201).json({ ok: true, id: workshop.id, mensaje: 'Taller ficticio registrado en memoria.' });
  }));
  app.delete('/api/talleres/:id', auth, admin, (req, res) => {
    const id = Number(req.params.id); const index = db.talleres.findIndex(item => item.id === id);
    if (index < 0) return fail(res, 404, 'No se encontró ese taller.');
    if (db.clientes.some(client => client.taller_id === id)) return fail(res, 409, 'El taller tiene clientes asociados. Reasígnalos antes de eliminarlo.');
    db.talleres.splice(index, 1); recordHistory('TALLER', id, 'ELIMINADO', null); res.json({ ok: true, mensaje: 'Taller eliminado de la memoria DEMO.' });
  });

  app.post('/api/clientes', auth, (req, res) => uploads.single('fotografia')(req, res, error => {
    if (error) return fail(res, 400, error.code === 'LIMIT_FILE_SIZE' ? 'La fotografía supera 5 MB.' : error.message);
    const fields = req.body || {}; const validation = validateClient(fields, req.file);
    if (validation) return fail(res, 400, validation);
    const workshopId = Number(fields.taller_id);
    if (!db.talleres.some(item => item.id === workshopId)) return fail(res, 400, 'Selecciona un taller existente.');
    const email = fields.correo_electronico.trim().toLowerCase(); const phone = fields.telefono_personal.trim();
    if (db.clientes.some(item => item.correo_electronico === email || item.telefono_personal === phone)) return fail(res, 409, 'Ya existe un cliente con ese correo o teléfono.');
    let vehicles;
    try { vehicles = parseDemoVehicles(fields.vehiculos); } catch (parseError) { return fail(res, 400, parseError.message); }
    const vehicleError = validateDemoVehicles(vehicles); if (vehicleError) return fail(res, 400, vehicleError);
    const client = { id: db.next.cliente++, nombre_completo: fields.nombre_completo.trim(), contacto_alternativo: fields.contacto_alternativo || null, fecha_nacimiento: fields.fecha_nacimiento, telefono_personal: phone, telefono_trabajo: fields.telefono_trabajo || null, correo_electronico: email, fotografia: photoData(req.file), calle: fields.calle.trim(), colonia: fields.colonia.trim(), municipio: fields.municipio.trim(), estado: fields.estado.trim(), codigo_postal: fields.codigo_postal, taller_id: workshopId, estatus: 'ACTIVO', creado_en: new Date().toISOString() };
    db.clientes.push(client);
    for (const vehicle of vehicles) { const id = db.next.vehiculo++; const entry = { ...vehicle, id, cliente_id: client.id, estatus: 'ACTIVO', actualizado_en: new Date().toISOString(), historial_kilometraje: [] }; if (vehicle.kilometraje !== null) entry.historial_kilometraje.push({ id: db.next.kilometraje++, kilometraje: vehicle.kilometraje, registrado_en: new Date().toISOString() }); db.vehiculos.push(entry); }
    recordHistory('CLIENTE', client.id, 'INSERTADO', { vehiculos: vehicles.length }); res.status(201).json({ ok: true, id: client.id, mensaje: 'Cliente y vehículos guardados únicamente en memoria DEMO.' });
  }));
  app.put('/api/clientes/:id', auth, (req, res) => uploads.single('fotografia')(req, res, error => {
    if (error) return fail(res, 400, error.message);
    const client = db.clientes.find(item => item.id === Number(req.params.id)); if (!client) return fail(res, 404, 'No se encontró ese cliente.');
    const fields = req.body || {}; const validation = validateClient(fields, req.file, true); if (validation) return fail(res, 400, validation);
    const email = fields.correo_electronico.trim().toLowerCase(); const phone = fields.telefono_personal.trim();
    if (db.clientes.some(item => item.id !== client.id && (item.correo_electronico === email || item.telefono_personal === phone))) return fail(res, 409, 'Ese correo o teléfono ya pertenece a otro cliente.');
    Object.assign(client, { nombre_completo: fields.nombre_completo.trim(), contacto_alternativo: fields.contacto_alternativo || null, fecha_nacimiento: fields.fecha_nacimiento, telefono_personal: phone, telefono_trabajo: fields.telefono_trabajo || null, correo_electronico: email, fotografia: req.file ? photoData(req.file) : client.fotografia, calle: fields.calle.trim(), colonia: fields.colonia.trim(), municipio: fields.municipio.trim(), estado: fields.estado.trim(), codigo_postal: fields.codigo_postal });
    recordHistory('CLIENTE', client.id, 'ACTUALIZADO', { accion: 'datos_actualizados' }); res.json({ ok: true, mensaje: 'Cliente actualizado en memoria DEMO.' });
  }));
  app.delete('/api/clientes/:id', auth, admin, (req, res) => {
    const id = Number(req.params.id); const index = db.clientes.findIndex(item => item.id === id);
    if (index < 0) return fail(res, 404, 'No se encontró ese cliente.');
    db.vehiculos = db.vehiculos.filter(item => item.cliente_id !== id); db.clientes.splice(index, 1); recordHistory('CLIENTE', id, 'ELIMINADO', null); res.json({ ok: true, mensaje: 'Cliente y sus vehículos de demostración eliminados de memoria.' });
  });
  app.post('/api/clientes/:id/suspender', auth, (req, res) => {
    const client = db.clientes.find(item => item.id === Number(req.params.id)); if (!client) return fail(res, 404, 'No se encontró ese cliente.');
    if (client.estatus !== 'ACTIVO') return fail(res, 409, 'El cliente no está activo.');
    client.estatus = 'SUSPENDIDO'; recordHistory('CLIENTE', client.id, 'SUSPENDIDO', null); res.json({ ok: true, mensaje: 'Cliente suspendido en memoria DEMO.' });
  });
  app.post('/api/clientes/:id/activar', auth, (req, res) => {
    const client = db.clientes.find(item => item.id === Number(req.params.id)); if (!client) return fail(res, 404, 'No se encontró ese cliente.');
    if (client.estatus !== 'SUSPENDIDO') return fail(res, 409, 'El cliente ya está activo.');
    client.estatus = 'ACTIVO'; recordHistory('CLIENTE', client.id, 'ACTIVADO', null); res.json({ ok: true, mensaje: 'Cliente activado en memoria DEMO.' });
  });
  app.get('/api/clientes', auth, (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1); const workshopId = req.query.taller ? Number(req.query.taller) : null;
    if (req.query.taller && !Number.isSafeInteger(workshopId)) return fail(res, 400, 'El filtro de taller no es válido.');
    const list = db.clientes.filter(item => !workshopId || item.taller_id === workshopId).sort((a, b) => (String(a.nombre_completo).localeCompare(b.nombre_completo, 'es') * (req.query.orden === 'desc' ? -1 : 1)) || a.id - b.id);
    const clients = list.slice((page - 1) * 10, page * 10).map(clientView);
    res.json({ ok: true, clientes, paginacion: { pagina: page, por_pagina: 10, total: list.length, paginas: Math.ceil(list.length / 10) } });
  });
  app.get('/api/clientes/:id', auth, (req, res) => {
    const client = db.clientes.find(item => item.id === Number(req.params.id)); if (!client) return fail(res, 404, 'No se encontró ese cliente.');
    const vehicles = db.vehiculos.filter(item => item.cliente_id === client.id).map(item => ({ ...item, historial_kilometraje: item.historial_kilometraje || [] }));
    res.json({ ok: true, cliente: { ...clientView(client), vehiculos: vehicles } });
  });
  app.get('/api/clientes/:id/fotografia', auth, (req, res) => {
    const data = db.clientes.find(item => item.id === Number(req.params.id))?.fotografia;
    if (!data) return fail(res, 404, 'Este cliente no tiene fotografía guardada en DEMO.');
    const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(data);
    if (!match) return fail(res, 404, 'La fotografía DEMO no está disponible.');
    res.type(match[1]).send(Buffer.from(match[2], 'base64'));
  });
  app.get('/api/vehiculos/clientes-activos', auth, (req, res) => res.json({ ok: true, clientes: db.clientes.filter(item => item.estatus === 'ACTIVO').sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo, 'es')).map(item => ({ id: item.id, nombre_completo: item.nombre_completo })) }));
  app.get('/api/vehiculos', auth, (req, res) => {
    const plates = String(req.query.placas || '').toUpperCase().replace(/[\s-]/g, '');
    if (plates && !/^[A-Z0-9]{3,15}$/.test(plates)) return fail(res, 400, 'Las placas deben contener de 3 a 15 letras o números.');
    res.json({ ok: true, vehiculos: db.vehiculos.filter(item => !plates || item.placas === plates).sort((a, b) => b.id - a.id).slice(0, 200).map(vehicleView) });
  });
  app.post('/api/vehiculos', auth, (req, res) => {
    const client = db.clientes.find(item => item.id === Number(req.body?.cliente_id) && item.estatus === 'ACTIVO');
    if (!client) return fail(res, 409, 'Selecciona un cliente activo existente.');
    let list; try { list = parseDemoVehicles(JSON.stringify([req.body])); } catch (error) { return fail(res, 400, error.message); }
    const validation = validateDemoVehicles(list); if (validation) return fail(res, 400, validation);
    const vehicle = { ...list[0], id: db.next.vehiculo++, cliente_id: client.id, estatus: 'ACTIVO', actualizado_en: new Date().toISOString(), historial_kilometraje: [] };
    if (vehicle.kilometraje !== null) vehicle.historial_kilometraje.push({ id: db.next.kilometraje++, kilometraje: vehicle.kilometraje, registrado_en: new Date().toISOString() });
    db.vehiculos.push(vehicle); recordHistory('VEHICULO', vehicle.id, 'INSERTADO', { cliente_id: client.id, vin: vehicle.vin }); res.status(201).json({ ok: true, id: vehicle.id, mensaje: 'Vehículo registrado en memoria DEMO.' });
  });
  app.put('/api/vehiculos/:id', auth, (req, res) => {
    const vehicle = db.vehiculos.find(item => item.id === Number(req.params.id)); if (!vehicle) return fail(res, 404, 'No se encontró ese vehículo.');
    if (vehicle.estatus !== 'ACTIVO') return fail(res, 409, 'Solo puedes editar vehículos activos.');
    let list; try { list = parseDemoVehicles(JSON.stringify([req.body])); } catch (error) { return fail(res, 400, error.message); }
    const updated = list[0];
    const validation = validateDemoVehicles(list);
    if (validation && !(validation === 'Ese VIN ya existe en el DEMO.' && updated.vin === vehicle.vin)) return fail(res, 400, validation);
    if (db.vehiculos.some(item => item.id !== vehicle.id && item.vin === updated.vin)) return fail(res, 409, 'Ese VIN ya existe.');
    if (vehicle.kilometraje !== null && updated.kilometraje !== null && updated.kilometraje < vehicle.kilometraje) return fail(res, 400, 'El kilometraje no puede disminuir.');
    const before = { ...vehicle }; Object.assign(vehicle, updated, { kilometraje: updated.kilometraje ?? vehicle.kilometraje, actualizado_en: new Date().toISOString() });
    if (vehicle.kilometraje !== before.kilometraje && vehicle.kilometraje !== null) vehicle.historial_kilometraje.push({ id: db.next.kilometraje++, kilometraje: vehicle.kilometraje, registrado_en: new Date().toISOString() });
    recordHistory('VEHICULO', vehicle.id, 'ACTUALIZADO', { antes: before, despues: { ...vehicle } }); res.json({ ok: true, mensaje: 'Vehículo actualizado en memoria DEMO.' });
  });
  app.delete('/api/vehiculos/:id', auth, (req, res) => {
    const vehicle = db.vehiculos.find(item => item.id === Number(req.params.id)); if (!vehicle) return fail(res, 404, 'No se encontró ese vehículo.');
    if (vehicle.estatus !== 'ACTIVO') return fail(res, 409, 'El vehículo ya está desactivado.');
    vehicle.estatus = 'SUSPENDIDO'; recordHistory('VEHICULO', vehicle.id, 'DESACTIVADO', null); res.json({ ok: true, mensaje: 'Vehículo desactivado en memoria DEMO.' });
  });
  app.post('/api/vehiculos/:id/reactivar', auth, (req, res) => {
    const vehicle = db.vehiculos.find(item => item.id === Number(req.params.id)); if (!vehicle) return fail(res, 404, 'No se encontró ese vehículo.');
    if (vehicle.estatus !== 'SUSPENDIDO') return fail(res, 409, 'El vehículo ya está activo.');
    vehicle.estatus = 'ACTIVO'; recordHistory('VEHICULO', vehicle.id, 'REACTIVADO', null); res.json({ ok: true, mensaje: 'Vehículo reactivado en memoria DEMO.' });
  });
  app.post('/api/clientes/:id/vehiculos/:vehiculoId/kilometraje', auth, (req, res) => {
    const vehicle = db.vehiculos.find(item => item.id === Number(req.params.vehiculoId) && item.cliente_id === Number(req.params.id));
    const mileage = req.body?.kilometraje;
    if (!vehicle) return fail(res, 404, 'No se encontró ese vehículo para el cliente.');
    if (!Number.isSafeInteger(mileage) || mileage < (vehicle.kilometraje || 0) || mileage > 2000000) return fail(res, 400, 'El kilometraje debe ser válido y no puede disminuir.');
    vehicle.kilometraje = mileage; vehicle.historial_kilometraje.push({ id: db.next.kilometraje++, kilometraje: mileage, registrado_en: new Date().toISOString() });
    recordHistory('VEHICULO', vehicle.id, 'KILOMETRAJE', { kilometraje: mileage }); res.json({ ok: true, mensaje: 'Kilometraje registrado en memoria DEMO.' });
  });
  app.get('/api/demo/estado', auth, (req, res) => res.json({ ok: true, resumen: { clientes: db.clientes.length, vehiculos: db.vehiculos.length, talleres: db.talleres.length, sesiones: sessions.size } }));
  app.use('/api', (req, res) => fail(res, 404, `Ruta API no disponible en DEMO: ${req.method} ${req.path}`));
}

module.exports = { configureDemo, DEMO_ACCOUNT };
