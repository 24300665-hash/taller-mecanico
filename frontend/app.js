const loginView = document.querySelector('#login-view');
const recoveryView = document.querySelector('#recovery-view');
const clientView = document.querySelector('#client-view');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let authenticatedUser = null;
let clients = [];
let workshops = [];
let clientPage = 1;
let clientPages = 1;
let clientTotal = 0;
let editingClientId = null;
let editingVehicleId = null;
let editingStatusId = null;
let geographyReady = false;
let vehicleCatalog = window.TallerVehicleCatalog || {};
let geographicCatalog = null;
let municipalitiesByState = new Map();
// Captura de vehículos pausada por ahora; conserva la implementación para reactivarla más adelante.
const VEHICLE_REGISTRATION_ENABLED = false;
document.querySelector('.vehicle-form-section').hidden = !VEHICLE_REGISTRATION_ENABLED;

document.querySelector('#year').textContent = new Date().getFullYear();

async function readApiResponse(response) {
  if (location.protocol === 'file:') throw new Error('Abre TallerPro desde http://localhost:3000/; al abrir index.html como archivo, las rutas de clientes y talleres no funcionan.');
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`El servidor devolvió una respuesta inesperada (HTTP ${response.status}). Revisa que el backend esté actualizado y activo.`);
  }
  try { return await response.json(); }
  catch { throw new Error('El servidor respondió con JSON inválido. Recarga la página e inténtalo de nuevo.'); }
}

function updateClientSubmitState() {
  const submit = document.querySelector('#client-form button[type="submit"]');
  submit.disabled = !geographyReady || workshops.length === 0;
  const help = document.querySelector('#client-workshop-help');
  help.textContent = workshops.length
    ? 'El cliente quedará asociado al taller seleccionado.'
    : 'No hay talleres registrados. Usa “Crear talleres” antes de registrar un cliente.';
}

// Cambiar entre login y recuperación
document.querySelectorAll('[data-view]').forEach(button =>
  button.addEventListener('click', () => {
    const recovery = button.dataset.view === 'recovery';
    loginView.hidden = recovery;
    recoveryView.hidden = !recovery;
    document.querySelector(recovery ? '#recovery-email' : '#email').focus();
  })
);

// Mostrar / ocultar contraseña
document.querySelector('.toggle').addEventListener('click', event => {
  const password = document.querySelector('#password');
  const hidden = password.type === 'password';
  password.type = hidden ? 'text' : 'password';
  event.currentTarget.textContent = hidden ? 'Ocultar' : 'Mostrar';
  event.currentTarget.setAttribute('aria-label', hidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
  event.currentTarget.setAttribute('aria-pressed', String(hidden));
});

// Validaciones
function error(input, message) {
  document.querySelector(`#${input.id}-error`).textContent = message;
  input.classList.toggle('invalid', Boolean(message));
  return !message;
}

function emailValid(input) {
  const value = input.value.trim();
  return error(
    input,
    !value
      ? 'El correo electrónico es obligatorio.'
      : !emailPattern.test(value)
      ? 'Escribe un correo electrónico válido.'
      : ''
  );
}

async function initializeGeographyFields() {
  if (geographicCatalog) return;
  municipalitiesByState.clear();
  const stateSelect = document.querySelector('#client-state');
  const municipalitySelect = document.querySelector('#client-city');
  const message = document.querySelector('#geography-message');
  const submit = document.querySelector('#client-form button[type="submit"]');

  try {
    const response = await fetch('/inegi-state-municipality.json');
    if (!response.ok) throw new Error('No se pudo cargar el catálogo geográfico.');
    const catalog = await response.json();
    const stateCodes = new Set();
    const stateNames = new Set();
    if (!Array.isArray(catalog.states) || catalog.states.length !== 32 || !Array.isArray(catalog.municipalities) || !catalog.municipalities.length)
      throw new Error('El catálogo geográfico no tiene la estructura esperada.');
    for (const state of catalog.states) {
      if (!/^\d{2}$/.test(state.code) || !state.name || stateCodes.has(state.code) || stateNames.has(state.name))
        throw new Error('El catálogo de estados contiene datos inválidos.');
      stateCodes.add(state.code);
      stateNames.add(state.name);
      municipalitiesByState.set(state.code, []);
    }
    const municipalityKeys = new Set();
    for (const municipality of catalog.municipalities) {
      const key = `${municipality.stateCode}${municipality.code}`;
      if (!stateCodes.has(municipality.stateCode) || !/^\d{3}$/.test(municipality.code) || !municipality.name || municipalityKeys.has(key))
        throw new Error('El catálogo de municipios contiene datos inválidos.');
      municipalityKeys.add(key);
      municipalitiesByState.get(municipality.stateCode).push(municipality);
    }
    if ([...municipalitiesByState.values()].some(items => !items.length))
      throw new Error('Faltan municipios en el catálogo geográfico.');

    geographicCatalog = catalog;
    geographyReady = true;
    stateSelect.replaceChildren(new Option('Selecciona un estado', ''));
    catalog.states.forEach(state => {
      const option = new Option(state.name, state.name);
      option.dataset.code = state.code;
      stateSelect.add(option);
    });
    stateSelect.disabled = false;
    resetMunicipalityOptions('Selecciona primero un estado', true);
    message.textContent = '';
    updateClientSubmitState();
  } catch (error) {
    geographyReady = false;
    stateSelect.disabled = true;
    municipalitySelect.disabled = true;
    message.textContent = 'No se pudo cargar el catálogo de estados y municipios. Recarga la página e inténtalo de nuevo.';
    submit.disabled = true;
  }
}

function resetMunicipalityOptions(label, disabled) {
  const municipalitySelect = document.querySelector('#client-city');
  municipalitySelect.replaceChildren(new Option(label, ''));
  municipalitySelect.disabled = disabled;
}

document.querySelector('#client-state').addEventListener('change', event => {
  const selectedState = event.currentTarget.selectedOptions[0];
  const stateCode = selectedState?.dataset.code;
  resetMunicipalityOptions(stateCode ? 'Selecciona un municipio' : 'Selecciona primero un estado', !stateCode);
  if (!stateCode || !municipalitiesByState.has(stateCode)) return;
  municipalitiesByState.get(stateCode)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .forEach(municipality => document.querySelector('#client-city').add(new Option(municipality.name, municipality.name)));
});

let postalLookupSequence = 0;
let lastValidPostalCode = '';
document.querySelector('#client-postal').addEventListener('input', async event => {
  const input = event.currentTarget;
  if (/[^0-9]/.test(input.value)) {
    input.value = lastValidPostalCode;
    document.querySelector('#geography-message').textContent = 'El código postal solo acepta números.';
    return;
  }
  input.value = input.value.slice(0, 5);
  lastValidPostalCode = input.value;
  const sequence = ++postalLookupSequence;
  const status = document.querySelector('#geography-message');
  if (input.value.length !== 5) {
    status.textContent = '';
    const stateSelect = document.querySelector('#client-state');
    if (geographicCatalog) {
      stateSelect.replaceChildren(new Option('Selecciona un estado', ''));
      geographicCatalog.states.forEach(state => { const option = new Option(state.name, state.name); option.dataset.code = state.code; stateSelect.add(option); });
      stateSelect.disabled = false;
      stateSelect.value = '';
      resetMunicipalityOptions('Selecciona primero un estado', true);
    }
    return;
  }
  status.textContent = 'Consultando código postal en SEPOMEX…';
  try {
    const response = await fetch(`/api/catalogo/codigo-postal/${encodeURIComponent(input.value)}`);
    const data = await readApiResponse(response);
    if (sequence !== postalLookupSequence) return;
    if (!response.ok) throw new Error(data.mensaje || 'No se encontró el código postal.');
    const locations = [...new Map(data.ubicaciones.map(location => [`${location.stateCode}-${location.municipalityCode}`, location])).values()];
    const states = [...new Map(locations.map(location => [location.stateCode, location])).values()];
    const stateSelect = document.querySelector('#client-state');
    stateSelect.replaceChildren(new Option(states.length > 1 ? 'Selecciona el estado del código postal' : states[0].state, ''));
    states.forEach(location => {
      const option = new Option(location.state, location.state);
      option.dataset.code = location.stateCode;
      stateSelect.add(option);
    });
    stateSelect.disabled = false;
    if (states.length === 1) {
      stateSelect.value = states[0].state;
      stateSelect.dispatchEvent(new Event('change'));
      const municipalitySelect = document.querySelector('#client-city');
      const matching = locations.filter(location => location.stateCode === states[0].stateCode);
      if (matching.length === 1) municipalitySelect.value = matching[0].municipality;
      else {
        municipalitySelect.replaceChildren(new Option('Selecciona el municipio del código postal', ''));
        matching.forEach(location => municipalitySelect.add(new Option(location.municipality, location.municipality)));
        municipalitySelect.disabled = false;
      }
    } else {
      stateSelect.addEventListener('change', () => {
        const stateCode = stateSelect.selectedOptions[0]?.dataset.code;
        const matches = locations.filter(location => location.stateCode === stateCode);
        const city = document.querySelector('#client-city');
        city.replaceChildren(new Option('Selecciona el municipio', ''));
        matches.forEach(location => city.add(new Option(location.municipality, location.municipality)));
        city.disabled = !stateCode;
      }, { once: true });
    }
    status.textContent = locations.length === 1 ? 'Estado y municipio encontrados en SEPOMEX.' : 'El código postal tiene más de una ubicación asociada; selecciona la correspondiente.';
  } catch (error) {
    if (sequence !== postalLookupSequence) return;
    const stateSelect = document.querySelector('#client-state');
    if (geographicCatalog) {
      stateSelect.replaceChildren(new Option('Selecciona un estado', ''));
      geographicCatalog.states.forEach(state => { const option = new Option(state.name, state.name); option.dataset.code = state.code; stateSelect.add(option); });
      stateSelect.disabled = false;
      stateSelect.value = '';
      resetMunicipalityOptions('Selecciona primero un estado', true);
    }
    status.textContent = error.message || 'No se pudo consultar el código postal.';
  }
});

// Login conectado al backend
document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();

  const email = document.querySelector('#email');
  const password = document.querySelector('#password');
  const message = document.querySelector('#login-message');

  const validPassword = error(
    password,
    !password.value
      ? 'La contraseña es obligatoria.'
      : password.value.length < 8
      ? 'La contraseña debe tener al menos 8 caracteres.'
      : ''
  );

  message.className = 'message';
  message.textContent = '';

  if (location.protocol === 'file:') {
    message.textContent = 'Abre el sistema desde http://localhost:3000/ para conectar con clientes, talleres y códigos postales.';
    return;
  }

  if (!(emailValid(email) && validPassword)) return;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: password.value })
    });
    const data = await readApiResponse(res);

    if (data.ok) {
      const authorizedRoles = ['ADMINISTRADOR', 'RECEPCIONISTA'];
      if (authorizedRoles.includes(String(data.usuario.rol).toUpperCase())) {
        authenticatedUser = data.usuario;
        document.querySelector('#show-statuses-button').hidden = String(data.usuario.rol).toUpperCase() !== 'ADMINISTRADOR';
        loginView.hidden = true;
        recoveryView.hidden = true;
        clientView.hidden = false;
        document.body.classList.add('workspace-mode');
        renderStaffProfile();
        await initializeGeographyFields();
        if (VEHICLE_REGISTRATION_ENABLED) resetVehicleRows();
        await Promise.all([loadWorkshops(), loadClients()]);
        document.querySelector('#show-clients-button').focus();
      } else {
        message.textContent = 'Tu cuenta no tiene permiso para registrar clientes.';
      }
    } else {
      message.textContent = data.mensaje;
    }
  } catch (error) {
    message.textContent = error.message || 'No se pudo conectar con el servidor.';
  }
});

document.querySelector('#back-to-login').addEventListener('click', () => {
  clientView.hidden = true;
  loginView.hidden = false;
  document.body.classList.remove('workspace-mode');
});

document.querySelector('#new-client-button').addEventListener('click', () => {
  showClientForm();
});

function showClientForm() {
  editingClientId = null;
  const form = document.querySelector('#client-form');
  form.reset();
  form.elements.namedItem('taller_id').disabled = false;
  lastValidPostalCode = '';
  form.querySelector('[name="fotografia"]').required = true;
  document.querySelector('#client-form-panel h2').textContent = 'Registrar cliente';
  form.querySelector('button[type="submit"]').lastChild.textContent = ' →';
  showWorkspacePanel('client-form-panel', 'show-create-client-button');
  document.querySelectorAll('.client-list-item').forEach(item => item.classList.remove('selected'));
  resetMunicipalityOptions('Selecciona primero un estado', true);
  document.querySelector('#client-name').focus();
}

async function loadWorkshops() {
  try {
    const response = await fetch('/api/talleres');
    const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.mensaje || 'No se pudieron cargar los talleres.');
    workshops = data.talleres;
    if (!Array.isArray(workshops)) throw new Error('La respuesta de talleres no tiene el formato esperado.');
    const selects = [document.querySelector('#client-workshop'), document.querySelector('#client-workshop-filter')];
    selects.forEach((select, index) => {
      const selected = select.value;
      select.replaceChildren(new Option(index ? 'Todos los talleres' : workshops.length ? 'Selecciona un taller' : 'No hay talleres registrados', ''));
      workshops.forEach(workshop => select.add(new Option(workshop.nombre, String(workshop.id))));
      if (workshops.some(workshop => String(workshop.id) === selected)) select.value = selected;
    });
    document.querySelector('#client-workshop').disabled = workshops.length === 0;
    updateClientSubmitState();
  } catch (error) {
    workshops = [];
    const select = document.querySelector('#client-workshop');
    select.replaceChildren(new Option('No se pudieron cargar los talleres', ''));
    select.disabled = true;
    document.querySelector('#client-workshop-help').textContent = error.message || 'No se pudieron cargar los talleres.';
    updateClientSubmitState();
  }
}

function showWorkspacePanel(panelId, buttonId) {
  for (const id of ['client-directory-panel', 'client-form-panel', 'workshop-form-panel', 'vehicle-search-panel', 'vehicle-admin-panel', 'status-admin-panel', 'client-details'])
    document.querySelector(`#${id}`).hidden = id !== panelId;
  document.querySelectorAll('.workspace-menu-item').forEach(button => button.classList.toggle('selected', button.id === buttonId));
}

document.querySelector('#show-clients-button').addEventListener('click', () => {
  showWorkspacePanel('client-directory-panel', 'show-clients-button');
  loadClients();
});
document.querySelector('#show-create-client-button').addEventListener('click', () => {
  showClientForm();
  document.querySelectorAll('.workspace-menu-item').forEach(button => button.classList.toggle('selected', button.id === 'show-create-client-button'));
});
document.querySelector('#show-create-workshop-button').addEventListener('click', () => {
  showWorkspacePanel('workshop-form-panel', 'show-create-workshop-button');
});
document.querySelector('#show-vehicle-search-button').addEventListener('click', () => {
  showWorkspacePanel('vehicle-search-panel', 'show-vehicle-search-button');
  document.querySelector('#vehicle-search-plates').focus();
});
document.querySelector('#show-vehicles-button').addEventListener('click', async () => {
  showWorkspacePanel('vehicle-admin-panel', 'show-vehicles-button');
  initializeVehicleAdminFields();
  await Promise.all([loadActiveVehicleClients(), loadVehicles()]);
});
document.querySelector('#show-statuses-button').addEventListener('click', async () => {
  showWorkspacePanel('status-admin-panel', 'show-statuses-button');
  await Promise.all([loadStatuses(), loadStatusHistory()]);
});

document.querySelector('#client-workshop-filter').addEventListener('change', () => { clientPage = 1; loadClients(); });
document.querySelector('#client-sort').addEventListener('change', () => { clientPage = 1; loadClients(); });
document.querySelector('#previous-page').addEventListener('click', () => { if (clientPage > 1) { clientPage--; loadClients(); } });
document.querySelector('#next-page').addEventListener('click', () => { if (clientPage < clientPages) { clientPage++; loadClients(); } });

document.querySelector('#add-vehicle-button').addEventListener('click', () => addVehicleRow());

function resetVehicleRows() {
  const rows = document.querySelector('#vehicle-rows');
  rows.replaceChildren();
  addVehicleRow();
}

function vehicleField(labelText, control, className = '') {
  const wrapper = document.createElement('label');
  wrapper.className = `vehicle-field ${className}`.trim();
  wrapper.append(document.createTextNode(labelText));
  wrapper.append(control);
  return wrapper;
}

function vehicleControl(tag, className, attrs = {}) {
  const control = document.createElement(tag);
  control.className = className;
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'text') control.textContent = value;
    else control.setAttribute(key, value);
  });
  return control;
}

function addVehicleRow() {
  const rows = document.querySelector('#vehicle-rows');
  if (rows.children.length >= 10) {
    document.querySelector('#client-message').textContent = 'Puedes registrar hasta 10 vehículos por cliente.';
    return;
  }
  const row = document.createElement('fieldset');
  row.className = 'vehicle-card';
  const legend = document.createElement('legend');
  legend.textContent = `Vehículo ${rows.children.length + 1}`;
  const fields = document.createElement('div');
  fields.className = 'vehicle-grid';

  const make = vehicleControl('select', 'vehicle-make');
  make.required = true;
  const makeEmpty = document.createElement('option'); makeEmpty.value = ''; makeEmpty.textContent = 'Selecciona una marca'; make.append(makeEmpty);
  Object.keys(vehicleCatalog).sort((a, b) => a.localeCompare(b, 'es')).forEach(name => {
    const option = document.createElement('option'); option.value = name; option.textContent = name; make.append(option);
  });

  const model = vehicleControl('select', 'vehicle-model', { disabled: '' });
  model.required = true;
  const modelEmpty = document.createElement('option'); modelEmpty.value = ''; modelEmpty.textContent = 'Selecciona primero la marca'; model.append(modelEmpty);
  const year = vehicleControl('select', 'vehicle-year');
  year.required = true;
  const anyYear = document.createElement('option'); anyYear.value = ''; anyYear.textContent = 'Selecciona un año'; year.append(anyYear);
  for (let y = new Date().getFullYear() + 1; y >= 1950; y--) { const option = document.createElement('option'); option.value = String(y); option.textContent = String(y); year.append(option); }
  const plates = vehicleControl('input', 'vehicle-plates', { type: 'text', maxlength: '15', minlength: '3', pattern: '[A-Za-z0-9 -]{3,15}', placeholder: 'Placas' });
  plates.required = true;
  const color = vehicleControl('input', 'vehicle-color', { type: 'text', maxlength: '40', placeholder: 'Color' });
  color.required = true;
  const vin = vehicleControl('input', 'vehicle-vin', { type: 'text', maxlength: '17', minlength: '17', pattern: '[A-HJ-NPR-Z0-9a-hj-npr-z]{17}', placeholder: '17 caracteres', autocomplete: 'off' });
  vin.required = true;
  const mileage = vehicleControl('input', 'vehicle-mileage', { type: 'number', min: '0', max: '2000000', step: '1', placeholder: 'Kilometraje actual' });

  const fillModels = () => {
    model.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Selecciona un modelo'; model.append(empty);
    (vehicleCatalog[make.value] || []).forEach(name => { const option = document.createElement('option'); option.value = name; option.textContent = name; model.append(option); });
    model.disabled = !make.value;
  };
  make.addEventListener('change', fillModels);

  fields.append(
    vehicleField('Marca *', make), vehicleField('Modelo *', model),
    vehicleField('Año *', year), vehicleField('Placas *', plates),
    vehicleField('Color *', color), vehicleField('VIN *', vin),
    vehicleField('Kilometraje (opcional)', mileage, 'vehicle-mileage-field')
  );
  const remove = vehicleControl('button', 'vehicle-remove', { type: 'button', text: 'Quitar vehículo' });
  remove.addEventListener('click', () => {
    if (rows.children.length <= 1) return;
    row.remove();
    [...rows.children].forEach((item, index) => {
      item.querySelector('legend').textContent = `Vehículo ${index + 1}`;
      item.querySelector('.vehicle-remove').disabled = rows.children.length === 1;
    });
  });
  row.append(legend, fields, remove);
  rows.append(row);
  [...rows.children].forEach(item => { item.querySelector('.vehicle-remove').disabled = rows.children.length === 1; });
}

function collectVehicles() {
  return [...document.querySelectorAll('.vehicle-card')].map(row => {
    const get = selector => row.querySelector(selector).value.trim();
    return {
      marca: get('.vehicle-make'), modelo: get('.vehicle-model'),
      anio: get('.vehicle-year'), placas: get('.vehicle-plates'), color: get('.vehicle-color'),
      vin: get('.vehicle-vin'), kilometraje: get('.vehicle-mileage')
    };
  }).filter(vehicle => Object.values(vehicle).some(Boolean));
}

async function loadActiveVehicleClients() {
  const select = document.querySelector('#vehicle-owner');
  try {
    const response = await fetch('/api/vehiculos/clientes-activos');
    const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.mensaje || 'No se pudieron cargar los clientes activos.');
    const selected = select.value;
    select.replaceChildren(new Option(data.clientes.length ? 'Selecciona un cliente' : 'No hay clientes activos', ''));
    data.clientes.forEach(client => select.add(new Option(client.nombre_completo, String(client.id))));
    if (data.clientes.some(client => String(client.id) === selected)) select.value = selected;
  } catch (error) {
    select.replaceChildren(new Option(error.message || 'No se pudieron cargar los clientes', ''));
  }
}

function initializeVehicleAdminFields() {
  const make = document.querySelector('#vehicle-admin-make');
  if (make.options.length > 1) return;
  Object.keys(vehicleCatalog).sort((a, b) => a.localeCompare(b, 'es')).forEach(name => make.add(new Option(name, name)));
  const year = document.querySelector('#vehicle-admin-year');
  for (let value = new Date().getFullYear() + 1; value >= 1950; value--) year.add(new Option(String(value), String(value)));
  make.addEventListener('change', () => {
    const model = document.querySelector('#vehicle-admin-model');
    model.replaceChildren(new Option(make.value ? 'Selecciona un modelo' : 'Selecciona primero la marca', ''));
    (vehicleCatalog[make.value] || []).forEach(name => model.add(new Option(name, name)));
    model.disabled = !make.value;
  });
  document.querySelector('#vehicle-admin-plates').addEventListener('input', event => {
    event.currentTarget.value = event.currentTarget.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '');
  });
  document.querySelector('#vehicle-admin-vin').addEventListener('input', event => { event.currentTarget.value = event.currentTarget.value.toUpperCase(); });
}

function resetVehicleAdminForm() {
  const form = document.querySelector('#vehicle-admin-form');
  form.reset();
  editingVehicleId = null;
  document.querySelector('#vehicle-owner').disabled = false;
  document.querySelector('#vehicle-admin-model').replaceChildren(new Option('Selecciona primero la marca', ''));
  document.querySelector('#vehicle-admin-model').disabled = true;
  document.querySelector('#vehicle-admin-message').textContent = '';
  form.querySelector('button[type="submit"]').textContent = 'Guardar vehículo →';
  document.querySelector('#vehicle-edit-cancel').hidden = true;
}

async function loadVehicles() {
  const message = document.querySelector('#vehicle-admin-message');
  const list = document.querySelector('#vehicle-admin-list');
  try {
    const response = await fetch('/api/vehiculos');
    const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.mensaje || 'No se pudieron cargar los vehículos.');
    list.replaceChildren();
    if (!data.vehiculos.length) {
      const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 7; cell.textContent = 'No hay vehículos registrados.'; row.append(cell); list.append(row);
      return;
    }
    data.vehiculos.forEach(vehicle => {
      const row = document.createElement('tr');
      const name = document.createElement('td'); name.textContent = [vehicle.marca, vehicle.modelo, vehicle.anio, vehicle.version].filter(Boolean).join(' ');
      const owner = document.createElement('td'); owner.textContent = vehicle.cliente;
      const workshop = document.createElement('td'); workshop.textContent = vehicle.taller || 'Sin taller asignado';
      const vin = document.createElement('td'); vin.textContent = vehicle.vin;
      const plates = document.createElement('td'); plates.textContent = vehicle.placas;
      const status = document.createElement('td'); status.textContent = vehicle.estatus;
      const actions = document.createElement('td');
      if (vehicle.estatus === 'ACTIVO') {
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'link'; edit.textContent = 'Editar'; edit.addEventListener('click', () => editVehicle(vehicle));
        const deactivate = document.createElement('button'); deactivate.type = 'button'; deactivate.className = 'link'; deactivate.textContent = 'Desactivar'; deactivate.addEventListener('click', () => changeVehicleActivation(vehicle, false));
        actions.append(edit, document.createTextNode(' · '), deactivate);
      } else {
        const reactivate = document.createElement('button'); reactivate.type = 'button'; reactivate.className = 'link'; reactivate.textContent = 'Reactivar'; reactivate.addEventListener('click', () => changeVehicleActivation(vehicle, true));
        actions.append(reactivate);
      }
      row.append(name, owner, workshop, vin, plates, status, actions); list.append(row);
    });
  } catch (error) { message.textContent = error.message || 'No se pudieron cargar los vehículos.'; }
}

async function changeVehicleActivation(vehicle, reactivate) {
  const message = document.querySelector('#vehicle-admin-message');
  const action = reactivate ? 'reactivar' : 'desactivar';
  const question = reactivate
    ? `¿Quieres reactivar el vehículo ${vehicle.placas}? Volverá a estar disponible para operación.`
    : `¿Quieres desactivar el vehículo ${vehicle.placas}? La ficha, el historial y cualquier información previa se conservarán.`;
  if (!window.confirm(question)) return;
  try {
    const response = await fetch(`/api/vehiculos/${encodeURIComponent(vehicle.id)}${reactivate ? '/reactivar' : ''}`, { method: reactivate ? 'POST' : 'DELETE' });
    const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.mensaje || `No se pudo ${action} el vehículo.`);
    message.className = 'message success';
    message.textContent = data.mensaje;
    await loadVehicles();
  } catch (error) {
    message.className = 'message';
    message.textContent = error.message || `No se pudo ${action} el vehículo.`;
  }
}

document.querySelector('#vehicle-search-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.querySelector('#vehicle-search-plates');
  const searchMessage = document.querySelector('#vehicle-search-message');
  input.value = input.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '');
  if (!input.value || input.value.replace(/[\s-]/g, '').length < 3) {
    searchMessage.className = 'message';
    searchMessage.textContent = 'Escribe las placas con al menos 3 caracteres.';
    return;
  }
  document.querySelector('#vehicle-search-clear').hidden = !input.value;
  searchMessage.className = 'message';
  searchMessage.textContent = input.value ? 'Consultando vehículo…' : '';
  loadVehicleSearch();
});

document.querySelector('#vehicle-search-clear').addEventListener('click', () => {
  document.querySelector('#vehicle-search-plates').value = '';
  document.querySelector('#vehicle-search-clear').hidden = true;
  document.querySelector('#vehicle-search-message').textContent = '';
  document.querySelector('#vehicle-search-list').replaceChildren();
});

async function loadVehicleSearch() {
  const plates = document.querySelector('#vehicle-search-plates').value.trim();
  const message = document.querySelector('#vehicle-search-message');
  const list = document.querySelector('#vehicle-search-list');
  try {
    const response = await fetch(`/api/vehiculos?placas=${encodeURIComponent(plates)}`);
    const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.mensaje || 'No se pudo consultar el vehículo.');
    list.replaceChildren();
    if (!data.vehiculos.length) {
      const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 6; cell.textContent = 'No se encontró un vehículo con esas placas.'; row.append(cell); list.append(row);
      message.className = 'message'; message.textContent = '';
      return;
    }
    data.vehiculos.forEach(vehicle => {
      const row = document.createElement('tr');
      const vehicleName = document.createElement('td'); vehicleName.textContent = [vehicle.marca, vehicle.modelo, vehicle.anio, vehicle.version].filter(Boolean).join(' ');
      const client = document.createElement('td'); client.textContent = vehicle.cliente;
      const workshop = document.createElement('td'); workshop.textContent = vehicle.taller || 'Sin taller asignado';
      const vin = document.createElement('td'); vin.textContent = vehicle.vin;
      const vehiclePlates = document.createElement('td'); vehiclePlates.textContent = vehicle.placas;
      const status = document.createElement('td'); status.textContent = vehicle.estatus;
      row.append(vehicleName, client, workshop, vin, vehiclePlates, status); list.append(row);
    });
    message.className = 'message success'; message.textContent = `${data.vehiculos.length} vehículo encontrado.`;
  } catch (error) {
    list.replaceChildren();
    message.className = 'message'; message.textContent = error.message || 'No se pudo consultar el vehículo.';
  }
}

function editVehicle(vehicle) {
  initializeVehicleAdminFields();
  resetVehicleAdminForm();
  editingVehicleId = vehicle.id;
  document.querySelector('#vehicle-owner').value = String(vehicle.cliente_id);
  document.querySelector('#vehicle-owner').disabled = true;
  const make = document.querySelector('#vehicle-admin-make'); make.value = vehicle.marca; make.dispatchEvent(new Event('change'));
  document.querySelector('#vehicle-admin-model').value = vehicle.modelo;
  document.querySelector('#vehicle-admin-year').value = String(vehicle.anio);
  document.querySelector('#vehicle-admin-version').value = vehicle.version || '';
  document.querySelector('#vehicle-admin-plates').value = vehicle.placas;
  document.querySelector('#vehicle-admin-color').value = vehicle.color;
  document.querySelector('#vehicle-admin-vin').value = vehicle.vin;
  document.querySelector('#vehicle-admin-serial').value = vehicle.numero_serie || '';
  document.querySelector('#vehicle-admin-mileage').value = vehicle.kilometraje ?? '';
  document.querySelector('#vehicle-admin-form button[type="submit"]').textContent = 'Guardar cambios →';
  document.querySelector('#vehicle-edit-cancel').hidden = false;
}

document.querySelector('#vehicle-admin-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('#vehicle-admin-message');
  message.textContent = '';
  if (!form.reportValidity()) return;
  const payload = {
    cliente_id: Number(document.querySelector('#vehicle-owner').value), marca: document.querySelector('#vehicle-admin-make').value,
    modelo: document.querySelector('#vehicle-admin-model').value, anio: document.querySelector('#vehicle-admin-year').value,
    version: document.querySelector('#vehicle-admin-version').value.trim(), placas: document.querySelector('#vehicle-admin-plates').value.trim(),
    color: document.querySelector('#vehicle-admin-color').value.trim(), vin: document.querySelector('#vehicle-admin-vin').value.trim(),
    numero_serie: document.querySelector('#vehicle-admin-serial').value.trim(), kilometraje: document.querySelector('#vehicle-admin-mileage').value
  };
  try {
    const response = await fetch(editingVehicleId ? `/api/vehiculos/${encodeURIComponent(editingVehicleId)}` : '/api/vehiculos', { method: editingVehicleId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.mensaje || 'No se pudo guardar el vehículo.');
    message.className = 'message success'; message.textContent = data.mensaje;
    resetVehicleAdminForm(); await Promise.all([loadVehicles(), loadActiveVehicleClients()]);
  } catch (error) { message.textContent = error.message || 'No se pudo guardar el vehículo.'; }
});
document.querySelector('#vehicle-edit-cancel').addEventListener('click', resetVehicleAdminForm);

function resetStatusForm() {
  document.querySelector('#status-admin-form').reset();
  editingStatusId = null;
  document.querySelector('#status-available').checked = true;
  document.querySelector('#status-admin-message').textContent = '';
  document.querySelector('#status-admin-form button[type="submit"]').textContent = 'Guardar estatus →';
  document.querySelector('#status-edit-cancel').hidden = true;
}

async function loadStatuses() {
  const list = document.querySelector('#status-admin-list');
  try {
    const response = await fetch('/api/estatus'); const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.mensaje || 'No se pudieron cargar los estatus.');
    list.replaceChildren();
    data.estatus.forEach(status => {
      const row = document.createElement('tr');
      const values = [status.id, status.strvalor, status.strdescripcion, status.disponible ? 'Sí' : 'No', status.referencias];
      values.forEach(value => { const cell = document.createElement('td'); cell.textContent = String(value ?? ''); row.append(cell); });
      const actions = document.createElement('td');
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'link'; edit.textContent = 'Editar'; edit.addEventListener('click', () => {
        editingStatusId = status.id; document.querySelector('#status-value').value = status.strvalor;
        document.querySelector('#status-description').value = status.strdescripcion; document.querySelector('#status-available').checked = Boolean(status.disponible);
        document.querySelector('#status-admin-form button[type="submit"]').textContent = 'Guardar cambios →'; document.querySelector('#status-edit-cancel').hidden = false;
      });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'link'; remove.textContent = 'Deshabilitar';
      remove.disabled = !status.disponible || status.referencias > 0 || ['ACTIVO', 'SUSPENDIDO', 'ELIMINADO'].includes(status.strvalor);
      remove.addEventListener('click', async () => {
        const result = await fetch(`/api/estatus/${encodeURIComponent(status.id)}`, { method: 'DELETE' }); const body = await readApiResponse(result);
        if (!result.ok) { document.querySelector('#status-admin-message').textContent = body.mensaje; return; }
        await Promise.all([loadStatuses(), loadStatusHistory()]);
      });
      actions.append(edit, document.createTextNode(' · '), remove); row.append(actions); list.append(row);
    });
  } catch (error) { document.querySelector('#status-admin-message').textContent = error.message || 'No se pudieron cargar los estatus.'; }
}

async function loadStatusHistory() {
  const list = document.querySelector('#status-history-list');
  try {
    const response = await fetch('/api/estatus/historial'); const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.mensaje || 'No se pudo cargar el historial.');
    list.replaceChildren();
    data.cambios.forEach(change => {
      const row = document.createElement('tr');
      [new Date(change.creado_en).toLocaleString('es-MX'), change.entidad, change.entidad_id, change.accion, change.usuario || 'Sistema', formatStatusHistoryDetail(change)].forEach(value => { const cell = document.createElement('td'); cell.textContent = String(value ?? ''); row.append(cell); });
      list.append(row);
    });
  } catch (error) { document.querySelector('#status-admin-message').textContent = error.message || 'No se pudo cargar el historial.'; }
}

function formatStatusHistoryDetail(change) {
  let detail = change.detalle;
  if (typeof detail === 'string') {
    try { detail = JSON.parse(detail); }
    catch { return detail.trim() || 'Sin detalles adicionales.'; }
  }
  if (!detail || typeof detail !== 'object') {
    if (change.entidad === 'CLIENTE' && change.accion === 'SUSPENDIDO') return 'Cliente suspendido.';
    if (change.entidad === 'CLIENTE' && change.accion === 'ACTIVO') return 'Cliente activado nuevamente.';
    if (change.entidad === 'VEHICULO' && change.accion === 'BAJA_LOGICA') return 'Vehículo dado de baja; el registro se conserva.';
    return 'Sin detalles adicionales.';
  }
  if (change.entidad === 'ESTATUS' && change.accion === 'INSERTADO') return `Estatus creado: ${detail.strvalor || 'sin valor'}.`;
  if (change.entidad === 'ESTATUS' && change.accion === 'ACTUALIZADO') {
    const previous = detail.anterior || {};
    const current = detail.nuevo || {};
    const changes = [];
    if (previous.strvalor !== current.strvalor) changes.push(`valor: ${previous.strvalor || 'sin valor'} a ${current.strvalor || 'sin valor'}`);
    if (previous.strdescripcion !== current.strdescripcion) changes.push('descripción actualizada');
    if (Number(previous.disponible) !== Number(current.disponible)) changes.push(current.disponible ? 'habilitado' : 'deshabilitado');
    return changes.length ? `Estatus actualizado: ${changes.join(', ')}.` : 'Estatus guardado sin cambios.';
  }
  if (change.entidad === 'ESTATUS' && change.accion === 'BAJA_LOGICA') return `Estatus ${detail.strvalor || ''} deshabilitado.`.trim();
  if (change.entidad === 'VEHICULO' && change.accion === 'INSERTADO') return `Vehículo asociado al cliente #${detail.cliente_id || 'no especificado'}.`;
  if (change.entidad === 'VEHICULO' && change.accion === 'ACTUALIZADO') return 'Datos del vehículo actualizados.';
  if (change.entidad === 'CLIENTE' && change.accion === 'ACTUALIZADO') return 'Datos del cliente actualizados.';
  return 'Actualización registrada.';
}

document.querySelector('#status-admin-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget; const message = document.querySelector('#status-admin-message');
  message.className = 'message'; message.textContent = '';
  if (!form.reportValidity()) return;
  const payload = { strvalor: document.querySelector('#status-value').value.trim(), strdescripcion: document.querySelector('#status-description').value.trim(), disponible: document.querySelector('#status-available').checked };
  try {
    const response = await fetch(editingStatusId ? `/api/estatus/${encodeURIComponent(editingStatusId)}` : '/api/estatus', { method: editingStatusId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await readApiResponse(response); if (!response.ok) throw new Error(data.mensaje || 'No se pudo guardar el estatus.');
    message.className = 'message success'; message.textContent = data.mensaje; resetStatusForm(); await Promise.all([loadStatuses(), loadStatusHistory()]);
  } catch (error) { message.textContent = error.message || 'No se pudo guardar el estatus.'; }
});
document.querySelector('#status-edit-cancel').addEventListener('click', resetStatusForm);

function renderStaffProfile() {
  const name = authenticatedUser?.nombre || 'Usuario';
  document.querySelector('#staff-name').textContent = name;
  document.querySelector('#staff-role').textContent = authenticatedUser?.rol || 'Personal';
  document.querySelector('#staff-avatar').textContent = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

async function loadClients() {
  const message = document.querySelector('#client-list-message');
  message.textContent = 'Cargando clientes…';
  try {
    const params = new URLSearchParams({ page: String(clientPage), orden: document.querySelector('#client-sort').value });
    const workshop = document.querySelector('#client-workshop-filter').value;
    if (workshop) params.set('taller', workshop);
    const response = await fetch(`/api/clientes?${params}`);
    const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.mensaje || 'No se pudo cargar la lista de clientes.');
    clients = data.clientes;
    clientPage = data.paginacion.pagina;
    clientPages = Math.max(1, data.paginacion.paginas);
    clientTotal = data.paginacion.total;
    renderClientList();
  } catch (loadError) {
    message.textContent = loadError.message || 'No se pudo conectar con el servidor.';
  }
}

function renderClientList() {
  const list = document.querySelector('#client-list');
  const message = document.querySelector('#client-list-message');
  list.replaceChildren();
  document.querySelector('#client-count').textContent = String(clientTotal);
  document.querySelector('#page-label').textContent = `Página ${clientPage} de ${clientPages}`;
  document.querySelector('#previous-page').disabled = clientPage <= 1;
  document.querySelector('#next-page').disabled = clientPage >= clientPages;
  message.textContent = clients.length ? '' : 'Todavía no hay clientes registrados.';
  clients.forEach(client => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'client-list-item';
    button.dataset.clientId = client.id;
    const avatar = document.createElement('span');
    avatar.className = 'client-list-avatar';
    if (client.fotografia) {
      const photo = document.createElement('img');
      photo.src = `/api/clientes/${encodeURIComponent(client.id)}/fotografia`;
      photo.alt = '';
      avatar.append(photo);
    } else {
      avatar.textContent = client.nombre_completo.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    }
    const summary = document.createElement('span');
    summary.className = 'client-list-summary';
    const name = document.createElement('strong');
    name.textContent = client.nombre_completo;
    const contact = document.createElement('small');
    contact.textContent = client.telefono_personal || '';
    const workshop = document.createElement('small');
    workshop.textContent = `${client.taller || 'Sin taller asignado'} · ${client.estatus || 'ACTIVO'}`;
    summary.append(name, contact, workshop);
    button.append(avatar, summary);
    list.append(button);
  });
  const directory = document.querySelector('#client-directory-list');
  directory.replaceChildren();
  clients.forEach(client => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    const nameButton = document.createElement('button');
    nameButton.type = 'button'; nameButton.className = 'directory-client-link'; nameButton.dataset.clientId = client.id; nameButton.textContent = client.nombre_completo;
    nameCell.append(nameButton);
    const workshopCell = document.createElement('td'); workshopCell.textContent = client.taller || 'Pendiente de asignación';
    const statusCell = document.createElement('td'); statusCell.textContent = client.estatus || 'ACTIVO';
    const contactCell = document.createElement('td'); contactCell.textContent = client.telefono_personal || client.correo_electronico || '';
    row.append(nameCell, workshopCell, statusCell, contactCell);
    directory.append(row);
  });
}

document.querySelector('#client-list').addEventListener('click', event => {
  const item = event.target.closest('[data-client-id]');
  if (item) showClientDetails(item.dataset.clientId);
});
document.querySelector('#client-directory-list').addEventListener('click', event => {
  const item = event.target.closest('[data-client-id]');
  if (item) showClientDetails(item.dataset.clientId);
});

async function showClientDetails(clientId) {
  const details = document.querySelector('#client-details');
  try {
    const response = await fetch(`/api/clientes/${encodeURIComponent(clientId)}`);
    const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.mensaje || 'No se pudo cargar el cliente.');
    renderClientDetails(data.cliente);
    document.querySelector('#client-form-panel').hidden = true;
    document.querySelector('#client-directory-panel').hidden = true;
    details.hidden = false;
    document.querySelectorAll('.client-list-item').forEach(item => item.classList.toggle('selected', item.dataset.clientId === String(clientId)));
  } catch (error) {
    details.replaceChildren();
    const message = document.createElement('p');
    message.className = 'message';
    message.textContent = error.message || 'No se pudo conectar con el servidor.';
    details.append(message);
    document.querySelector('#client-form-panel').hidden = true;
    document.querySelector('#client-directory-panel').hidden = true;
    details.hidden = false;
  }
}

function renderClientDetails(client) {
  const details = document.querySelector('#client-details');
  details.replaceChildren();
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'PERFIL DEL CLIENTE';
  const heading = document.createElement('h2');
  heading.textContent = client.nombre_completo;
  const hero = document.createElement('div');
  hero.className = 'client-detail-hero';
  if (client.fotografia) {
    const photo = document.createElement('img');
    photo.className = 'client-detail-photo';
    photo.src = `/api/clientes/${encodeURIComponent(client.id)}/fotografia`;
    photo.alt = `Fotografía de ${client.nombre_completo}`;
    hero.append(photo);
  }
  const created = document.createElement('p');
  created.className = 'intro';
  created.textContent = `Cliente registrado${client.creado_en ? ` el ${new Date(client.creado_en).toLocaleDateString('es-MX')}` : ''}.`;
  hero.append(created);
  details.append(eyebrow, heading, hero);
  const actionRow = document.createElement('div');
  actionRow.className = 'detail-actions';
  const editButton = document.createElement('button');
  editButton.type = 'button'; editButton.className = 'secondary-button'; editButton.textContent = 'Editar cliente';
  editButton.addEventListener('click', () => editClient(client));
  actionRow.append(editButton);
  if (['ADMINISTRADOR', 'RECEPCIONISTA'].includes(String(authenticatedUser?.rol).toUpperCase())) {
    const isSuspended = client.estatus === 'SUSPENDIDO';
    const statusButton = document.createElement('button');
    statusButton.type = 'button'; statusButton.className = 'secondary-button'; statusButton.textContent = isSuspended ? 'Activar cliente' : 'Suspender cliente';
    statusButton.addEventListener('click', async () => {
      statusButton.disabled = true;
      try {
        const action = isSuspended ? 'activar' : 'suspender';
        const response = await fetch(`/api/clientes/${encodeURIComponent(client.id)}/${action}`, { method: 'POST' });
        const data = await readApiResponse(response);
        if (!response.ok) throw new Error(data.mensaje || `No se pudo ${action} el cliente.`);
        await showClientDetails(client.id);
        await loadClients();
      } catch (error) { statusButton.disabled = false; statusButton.title = error.message; }
    });
    actionRow.append(statusButton);
  }
  details.append(actionRow);

  const sections = [
    ['Contacto', [['Contacto alternativo', client.contacto_alternativo], ['Fecha de nacimiento', formatClientDate(client.fecha_nacimiento)], ['Teléfono personal', client.telefono_personal], ['Teléfono de trabajo', client.telefono_trabajo], ['Correo electrónico', client.correo_electronico]]],
    ['Dirección', [['Calle', client.calle], ['Colonia', client.colonia], ['Municipio', client.municipio], ['Estado', client.estado], ['Código postal', client.codigo_postal]]],
    ['Administración', [['Estatus', client.estatus || 'ACTIVO'], ['Taller', client.taller || 'Pendiente de asignación']]]
  ];
  const vehicles = client.vehiculos || [];
  sections.forEach(([title, entries]) => {
    const section = document.createElement('section');
    section.className = 'detail-section';
    const sectionTitle = document.createElement('h3');
    sectionTitle.textContent = title;
    const grid = document.createElement('dl');
    grid.className = 'detail-grid';
    entries.forEach(([label, value]) => {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value || 'No proporcionado';
      row.append(term, description);
      grid.append(row);
    });
    section.append(sectionTitle, grid);
    details.append(section);
  });
  if (vehicles.length) {
    const heading = document.createElement('h3');
    heading.className = 'vehicle-details-heading';
    heading.textContent = 'Vehículos';
    details.append(heading);
    vehicles.forEach((vehicle, index) => {
      const section = document.createElement('section');
      section.className = 'detail-section vehicle-detail-card';
      const title = document.createElement('h3');
      title.textContent = `Vehículo ${index + 1}: ${[vehicle.marca, vehicle.modelo, vehicle.anio].filter(Boolean).join(' ') || 'Sin marca, modelo o año'}`;
      const grid = document.createElement('dl');
      grid.className = 'detail-grid';
      [['Estatus', vehicle.estatus], ['Versión', vehicle.version], ['Placas', vehicle.placas], ['Color', vehicle.color], ['VIN / número de serie', vehicle.numero_serie || vehicle.vin], ['Kilometraje actual', vehicle.kilometraje == null ? '' : `${Number(vehicle.kilometraje).toLocaleString('es-MX')} km`]].forEach(([label, value]) => {
        const row = document.createElement('div');
        const term = document.createElement('dt'); term.textContent = label;
        const description = document.createElement('dd'); description.textContent = value || 'No proporcionado';
        row.append(term, description); grid.append(row);
      });
      section.append(title, grid);

      const readings = document.createElement('ul');
      readings.className = 'mileage-history';
      (vehicle.historial_kilometraje || []).forEach(reading => {
        const item = document.createElement('li');
        const when = new Date(reading.registrado_en);
        item.textContent = `${Number(reading.kilometraje).toLocaleString('es-MX')} km · ${Number.isNaN(when.getTime()) ? 'fecha no disponible' : when.toLocaleString('es-MX')}`;
        readings.append(item);
      });
      const historyTitle = document.createElement('h4'); historyTitle.textContent = 'Lecturas por visita';
      section.append(historyTitle, readings);

      if (vehicle.estatus !== 'ACTIVO') { details.append(section); return; }
      const updateForm = document.createElement('form');
      updateForm.className = 'mileage-update-form';
      updateForm.dataset.clientId = client.id;
      updateForm.dataset.vehicleId = vehicle.id;
      const input = document.createElement('input');
      input.type = 'number'; input.min = '0'; input.max = '2000000'; input.step = '1'; input.required = true;
      input.placeholder = 'Kilometraje de esta visita'; input.setAttribute('aria-label', `Nuevo kilometraje para vehículo ${index + 1}`);
      const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'secondary-button'; submit.textContent = 'Registrar visita';
      const status = document.createElement('p'); status.className = 'mileage-message message'; status.setAttribute('role', 'status');
      updateForm.append(input, submit, status);
      section.append(updateForm);
      details.append(section);
    });
  }
}

function editClient(client) {
  showClientForm();
  editingClientId = client.id;
  document.querySelectorAll('.workspace-menu-item').forEach(button => button.classList.toggle('selected', button.id === 'show-clients-button'));
  const form = document.querySelector('#client-form');
  for (const key of ['taller_id', 'nombre_completo', 'contacto_alternativo', 'fecha_nacimiento', 'telefono_personal', 'telefono_trabajo', 'correo_electronico', 'calle', 'colonia', 'codigo_postal']) {
    const control = form.elements.namedItem(key);
    if (control) control.value = key === 'fecha_nacimiento' ? String(client[key] ?? '').slice(0, 10) : client[key] ?? '';
  }
  form.elements.namedItem('taller_id').disabled = true;
  lastValidPostalCode = client.codigo_postal || '';
  const state = document.querySelector('#client-state');
  state.value = client.estado;
  state.dispatchEvent(new Event('change'));
  document.querySelector('#client-city').value = client.municipio;
  form.elements.namedItem('fotografia').required = false;
  document.querySelector('#client-form-panel h2').textContent = 'Editar cliente';
  const button = form.querySelector('button[type="submit"]');
  button.firstChild.textContent = 'Guardar cambios ';
}

document.querySelector('#client-details').addEventListener('submit', async event => {
  const form = event.target.closest('.mileage-update-form');
  if (!form) return;
  event.preventDefault();
  const status = form.querySelector('.mileage-message');
  const submit = form.querySelector('button[type=submit]');
  submit.disabled = true;
  try {
    const response = await fetch(`/api/clientes/${encodeURIComponent(form.dataset.clientId)}/vehiculos/${encodeURIComponent(form.dataset.vehicleId)}/kilometraje`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kilometraje: Number(form.querySelector('input').value) })
    });
    const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.mensaje || 'No se pudo registrar el kilometraje.');
    await showClientDetails(form.dataset.clientId);
  } catch (error) {
    status.textContent = error.message || 'No se pudo conectar con el servidor.';
  } finally {
    submit.disabled = false;
  }
});

function formatClientDate(value) {
  if (!value) return 'No proporcionado';
  const datePart = String(value).slice(0, 10);
  const date = new Date(`${datePart}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? 'No disponible'
    : date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

document.querySelector('#client-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('#client-message');
  message.className = 'message';
  message.textContent = '';
  const email = document.querySelector('#client-email').value.trim();
  if (!form.reportValidity()) return;
  if (!emailPattern.test(email)) {
    message.textContent = 'Escribe un correo electrónico válido.';
    return;
  }
  const photo = document.querySelector('#client-photo').files[0];
  if (photo && photo.size > 5 * 1024 * 1024) {
    message.textContent = 'La fotografía no debe superar 5 MB.';
    return;
  }
  try {
    const formData = new FormData(form);
    if (VEHICLE_REGISTRATION_ENABLED) formData.set('vehiculos', JSON.stringify(collectVehicles()));
    const response = await fetch(editingClientId ? `/api/clientes/${encodeURIComponent(editingClientId)}` : '/api/clientes', { method: editingClientId ? 'PUT' : 'POST', body: formData });
    const data = await readApiResponse(response);
    if (!response.ok) {
      message.textContent = data.mensaje || 'No se pudo registrar el cliente.';
      return;
    }
    message.className = 'message success';
    message.textContent = data.mensaje;
    const savedId = editingClientId;
    form.reset();
    lastValidPostalCode = '';
    editingClientId = null;
    form.elements.namedItem('fotografia').required = true;
    resetMunicipalityOptions('Selecciona primero un estado', true);
    if (VEHICLE_REGISTRATION_ENABLED) resetVehicleRows();
    await loadClients();
    if (savedId) await showClientDetails(savedId);
  } catch {
    message.textContent = 'No se pudo conectar con el servidor.';
  }
});

document.querySelector('#workshop-rfc').addEventListener('input', event => { event.currentTarget.value = event.currentTarget.value.toUpperCase(); });
document.querySelector('#workshop-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('#workshop-message');
  message.className = 'message'; message.textContent = '';
  if (!form.reportValidity()) return;
  const rfc = form.elements.namedItem('rfc').value.trim().toUpperCase();
  const rfcPattern = /^(?:[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}|[A-ZÑ&]{4}\d{6}[A-Z0-9]{3})$/;
  if (!rfcPattern.test(rfc)) { message.textContent = 'El RFC debe tener el formato válido de persona física o moral mexicana.'; return; }
  if (workshops.some(workshop => workshop.rfc === rfc)) { message.textContent = 'Ya existe un taller registrado con ese RFC.'; return; }
  const photo = form.elements.namedItem('fotografia').files[0];
  if (!photo || photo.size > 15 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) {
    message.textContent = 'Selecciona una fotografía JPG, PNG o WEBP de máximo 15 MB.'; return;
  }
  const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
  try {
    const response = await fetch('/api/talleres', { method: 'POST', body: new FormData(form) });
    const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.mensaje || 'No se pudo registrar el taller.');
    message.className = 'message success'; message.textContent = data.mensaje;
    form.reset();
    await loadWorkshops();
    document.querySelector('#client-workshop').value = String(data.id);
  } catch (error) { message.textContent = error.message || 'No se pudo conectar con el servidor.'; }
  finally { submit.disabled = false; }
});

// Recuperación de contraseña (por ahora solo valida el correo)
document.querySelector('#recovery-form').addEventListener('submit', event => {
  event.preventDefault();
  const email = document.querySelector('#recovery-email');
  const message = document.querySelector('#recovery-message');

  if (emailValid(email)) {
    message.className = 'message success';
    message.textContent = 'Si existe una cuenta asociada, recibirás las instrucciones en tu correo.';
  } else {
    message.className = 'message';
    message.textContent = '';
  }
});

// Quitar el estado de error al escribir
document.querySelectorAll('input[type=email],input[type=password]').forEach(input =>
  input.addEventListener('input', () => input.classList.remove('invalid'))
);
