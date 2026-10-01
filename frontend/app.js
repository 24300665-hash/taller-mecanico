const loginView = document.querySelector('#login-view');
const recoveryView = document.querySelector('#recovery-view');
const clientView = document.querySelector('#client-view');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let authenticatedUser = null;
let clients = [];
let vehicleCatalog = window.TallerVehicleCatalog || {};

document.querySelector('#year').textContent = new Date().getFullYear();

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

  if (!(emailValid(email) && validPassword)) return;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: password.value })
    });
    const data = await res.json();

    if (data.ok) {
      const authorizedRoles = ['ADMINISTRADOR', 'RECEPCIONISTA'];
      if (authorizedRoles.includes(String(data.usuario.rol).toUpperCase())) {
        authenticatedUser = data.usuario;
        loginView.hidden = true;
        recoveryView.hidden = true;
        clientView.hidden = false;
        document.body.classList.add('workspace-mode');
        renderStaffProfile();
        resetVehicleRows();
        await loadClients();
        document.querySelector('#client-name').focus();
      } else {
        message.textContent = 'Tu cuenta no tiene permiso para registrar clientes.';
      }
    } else {
      message.textContent = data.mensaje;
    }
  } catch {
    message.textContent = 'No se pudo conectar con el servidor.';
  }
});

document.querySelector('#back-to-login').addEventListener('click', () => {
  clientView.hidden = true;
  loginView.hidden = false;
  document.body.classList.remove('workspace-mode');
});

document.querySelector('#new-client-button').addEventListener('click', () => {
  document.querySelector('#client-details').hidden = true;
  document.querySelector('#client-form-panel').hidden = false;
  document.querySelectorAll('.client-list-item').forEach(item => item.classList.remove('selected'));
  document.querySelector('#client-name').focus();
});

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
    const response = await fetch('/api/clientes');
    const data = await response.json();
    if (!response.ok) throw new Error(data.mensaje || 'No se pudo cargar la lista de clientes.');
    clients = data.clientes;
    renderClientList();
  } catch (loadError) {
    message.textContent = loadError.message || 'No se pudo conectar con el servidor.';
  }
}

function renderClientList() {
  const list = document.querySelector('#client-list');
  const message = document.querySelector('#client-list-message');
  list.replaceChildren();
  document.querySelector('#client-count').textContent = String(clients.length);
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
    contact.textContent = client.telefono_personal;
    summary.append(name, contact);
    button.append(avatar, summary);
    list.append(button);
  });
}

document.querySelector('#client-list').addEventListener('click', event => {
  const item = event.target.closest('[data-client-id]');
  if (item) showClientDetails(item.dataset.clientId);
});

async function showClientDetails(clientId) {
  const details = document.querySelector('#client-details');
  try {
    const response = await fetch(`/api/clientes/${encodeURIComponent(clientId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.mensaje || 'No se pudo cargar el cliente.');
    renderClientDetails(data.cliente);
    document.querySelector('#client-form-panel').hidden = true;
    details.hidden = false;
    document.querySelectorAll('.client-list-item').forEach(item => item.classList.toggle('selected', item.dataset.clientId === String(clientId)));
  } catch (error) {
    details.replaceChildren();
    const message = document.createElement('p');
    message.className = 'message';
    message.textContent = error.message || 'No se pudo conectar con el servidor.';
    details.append(message);
    document.querySelector('#client-form-panel').hidden = true;
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

  const sections = [
    ['Contacto', [['Contacto alternativo', client.contacto_alternativo], ['Fecha de nacimiento', formatClientDate(client.fecha_nacimiento)], ['Teléfono personal', client.telefono_personal], ['Teléfono de trabajo', client.telefono_trabajo], ['Correo electrónico', client.correo_electronico]]],
    ['Dirección', [['Calle', client.calle], ['Colonia', client.colonia], ['Municipio', client.municipio], ['Estado', client.estado], ['Código postal', client.codigo_postal]]]
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
      [['Placas', vehicle.placas], ['Color', vehicle.color], ['VIN', vehicle.vin], ['Kilometraje actual', vehicle.kilometraje == null ? '' : `${Number(vehicle.kilometraje).toLocaleString('es-MX')} km`]].forEach(([label, value]) => {
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
    const data = await response.json();
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
    formData.set('vehiculos', JSON.stringify(collectVehicles()));
    const response = await fetch('/api/clientes', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) {
      message.textContent = data.mensaje || 'No se pudo registrar el cliente.';
      return;
    }
    message.className = 'message success';
    message.textContent = data.mensaje;
    form.reset();
    resetVehicleRows();
    await loadClients();
  } catch {
    message.textContent = 'No se pudo conectar con el servidor.';
  }
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
