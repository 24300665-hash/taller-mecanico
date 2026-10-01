-- Ejecutar una vez sobre la base indicada por DB_NAME.
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
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_clientes_correo UNIQUE (correo_electronico),
  CONSTRAINT uq_clientes_telefono_personal UNIQUE (telefono_personal)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vehículos asociados: un cliente puede registrar varias unidades.
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
