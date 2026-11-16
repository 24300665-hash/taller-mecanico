-- Ejecutar una vez sobre la base indicada por DB_NAME.
CREATE TABLE IF NOT EXISTS talleres (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS estatus (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  strvalor VARCHAR(40) NOT NULL,
  strdescripcion VARCHAR(255) NOT NULL,
  disponible TINYINT(1) NOT NULL DEFAULT 1,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uq_estatus_strvalor (strvalor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO estatus (strvalor, strdescripcion) VALUES
('ACTIVO', 'Registro habilitado para operar.'),
('SUSPENDIDO', 'Registro suspendido temporalmente.'),
('ELIMINADO', 'Registro dado de baja lógica; se conserva la información.'),
('ACTUALIZADO', 'Se modificaron los datos del registro.'),
('CANCELADO', 'Registro cancelado.');

CREATE TABLE IF NOT EXISTS clientes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre_completo VARCHAR(150) NOT NULL,
  contacto_alternativo VARCHAR(120) NULL,
  fecha_nacimiento DATE NOT NULL,
  telefono_personal VARCHAR(20) NOT NULL,
  telefono_trabajo VARCHAR(20) NULL,
  correo_electronico VARCHAR(254) NOT NULL,
  fotografia VARCHAR(255) NOT NULL,
  calle VARCHAR(150) NOT NULL,
  colonia VARCHAR(100) NOT NULL,
  municipio VARCHAR(100) NOT NULL,
  estado VARCHAR(100) NOT NULL,
  codigo_postal CHAR(5) NOT NULL,
  taller_id BIGINT UNSIGNED NULL,
  estatus_id BIGINT UNSIGNED NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_clientes_taller_nombre (taller_id, nombre_completo, id),
  CONSTRAINT fk_clientes_taller FOREIGN KEY (taller_id) REFERENCES talleres(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT uq_clientes_correo UNIQUE (correo_electronico),
  CONSTRAINT uq_clientes_telefono_personal UNIQUE (telefono_personal),
  CONSTRAINT fk_clientes_estatus FOREIGN KEY (estatus_id) REFERENCES estatus(id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vehículos asociados: un cliente puede registrar varias unidades.
CREATE TABLE IF NOT EXISTS cliente_vehiculos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cliente_id BIGINT UNSIGNED NOT NULL,
  marca VARCHAR(60) NULL,
  modelo VARCHAR(80) NULL,
  anio SMALLINT UNSIGNED NULL,
  version VARCHAR(80) NULL,
  placas VARCHAR(15) NULL,
  color VARCHAR(40) NULL,
  vin CHAR(17) NULL,
  numero_serie VARCHAR(80) NULL,
  kilometraje INT UNSIGNED NULL,
  estatus_id BIGINT UNSIGNED NOT NULL,
  eliminado_en TIMESTAMP NULL,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cliente_vehiculos_vin (vin),
  KEY ix_cliente_vehiculos_cliente (cliente_id),
  CONSTRAINT fk_cliente_vehiculos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
  CONSTRAINT fk_cliente_vehiculos_estatus FOREIGN KEY (estatus_id) REFERENCES estatus(id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cliente_vehiculo_kilometrajes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehiculo_id BIGINT UNSIGNED NOT NULL,
  kilometraje INT UNSIGNED NOT NULL,
  registrado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_vehiculo_kilometrajes_vehiculo_fecha (vehiculo_id, registrado_en),
  CONSTRAINT fk_vehiculo_kilometrajes_vehiculo FOREIGN KEY (vehiculo_id) REFERENCES cliente_vehiculos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS historial_estatus (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entidad VARCHAR(30) NOT NULL,
  entidad_id BIGINT UNSIGNED NOT NULL,
  accion VARCHAR(30) NOT NULL,
  detalle JSON NULL,
  usuario_id BIGINT UNSIGNED NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY ix_historial_estatus_entidad (entidad, entidad_id, creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
