const express = require('express');
const path = require('path');
require('dotenv').config();
const { Pool } = require('pg');
const Stripe = require('stripe');

const app = express();
const PORT = process.env.PORT || 3000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Create tables (if they don't exist yet) and seed a few sample routes.
// This runs on every app startup, which keeps local dev and container
// restarts simple, at the cost of not being a "real" migration system —
// worth mentioning as a known simplification in your write-up.
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS buses (
      id SERIAL PRIMARY KEY,
      route_from VARCHAR(100) NOT NULL,
      route_to VARCHAR(100) NOT NULL,
      departure_time VARCHAR(50) NOT NULL,
      price_cents INTEGER NOT NULL,
      total_seats INTEGER NOT NULL DEFAULT 40
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      bus_id INTEGER REFERENCES buses(id),
      passenger_name VARCHAR(100) NOT NULL,
      seat_number INTEGER NOT NULL,
      stripe_session_id VARCHAR(200),
      payment_status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  const { rows } = await pool.query('SELECT COUNT(*) FROM buses');
  if (parseInt(rows[0].count, 10) === 0) {
    await pool.query(`
      INSERT INTO buses (route_from, route_to, departure_time, price_cents, total_seats) VALUES
      ('Lagos', 'Abuja', '07:00 AM', 1500000, 40),
      ('Lagos', 'Ibadan', '09:30 AM', 350000, 30),
      ('Abuja', 'Kano', '01:00 PM', 1200000, 40),
      ('Port Harcourt', 'Lagos', '06:00 AM', 1800000, 45);
    `);
  }
}
initDb().catch(err => console.error('DB init error:', err));

// Home — list available buses, read live from the database
app.get('/', async (req, res) => {
  try {
    const { rows: buses } = await pool.query('SELECT * FROM buses ORDER BY id');
    res.render('index', { buses });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading buses');
  }
});

// Seat selection / passenger details form for one bus
app.get('/book/:busId', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM buses WHERE id = $1', [req.params.busId]);
    if (rows.length === 0) return res.status(404).send('Bus not found');

    const { rows: booked } = await pool.query(
      "SELECT seat_number FROM bookings WHERE bus_id = $1 AND payment_status = 'paid'",
      [req.params.busId]
    );
    const bookedSeats = booked.map(b => b.seat_number);

    res.render('book', { bus: rows[0], bookedSeats });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading bus');
  }
});

// Create a Stripe Checkout session and send the user to Stripe's hosted
// payment page. We never handle card numbers ourselves — Stripe does —
// which is both simpler and avoids PCI compliance concerns entirely.
app.post('/book/:busId', async (req, res) => {
  const { passenger_name, seat_number } = req.body;
  const busId = req.params.busId;
  try {
    const { rows } = await pool.query('SELECT * FROM buses WHERE id = $1', [busId]);
    if (rows.length === 0) return res.status(404).send('Bus not found');
    const bus = rows[0];

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `${bus.route_from} to ${bus.route_to} — Seat ${seat_number}` },
          unit_amount: bus.price_cents
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${req.protocol}://${req.get('host')}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}/cancel`,
      metadata: { bus_id: busId, seat_number, passenger_name }
    });

    // Record a pending booking now, so we have a row even if the user
    // abandons payment. It gets flipped to "paid" in /success below.
    await pool.query(
      `INSERT INTO bookings (bus_id, passenger_name, seat_number, stripe_session_id, payment_status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [busId, passenger_name, seat_number, session.id]
    );

    res.redirect(303, session.url);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating checkout session');
  }
});

// Stripe redirects here after a successful payment
app.get('/success', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
    if (session.payment_status === 'paid') {
      await pool.query(
        "UPDATE bookings SET payment_status = 'paid' WHERE stripe_session_id = $1",
        [session.id]
      );
    }
    res.render('success', { session });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error confirming payment');
  }
});

app.get('/cancel', (req, res) => res.render('cancel'));

// Health check endpoint — used by Kubernetes liveness/readiness probes later
app.get('/health', (req, res) => res.status(200).send('OK'));

app.listen(PORT, () => console.log(`Bus ticketing app listening on port ${PORT}`));
