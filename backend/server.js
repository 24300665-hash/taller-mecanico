require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
});

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

    res.json({ ok: true, usuario: { id: user.id, nombre: user.nombre, rol: user.rol } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, mensaje: 'Error del servidor.' });
  }
});

app.listen(process.env.PORT, () =>
  console.log(`Servidor en http://localhost:${process.env.PORT}`));