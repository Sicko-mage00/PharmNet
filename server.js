import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { initSocket } from './src/services/socket.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import session from 'express-session';
import helmet from 'helmet';

import authRoute from './src/routes/auth.js';
import facilityRoute from './src/routes/facility.js';
import facilityKeyRoute from './src/routes/facilityKey.js';
import inventoryRoute from './src/routes/inventory.js';
import saleRoute from './src/routes/sale.js';
import alertRoute from './src/routes/alert.js';
import viewRoute from './src/routes/view.js';
import { checkExpiredAlerts } from './src/services/alertExpiry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

initSocket(io);
app.use(helmet({
  contentSecurityPolicy: false,
}));

//Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, 'src/public')));
app.use(session({
  secret: process.env.SESSION_SECRET, // Secure key
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));


//View engine
app.set('view engine', 'pug');
app.set('views', join(__dirname, 'src/views'));

//Database
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// Routes
app.use('/', viewRoute); // mount BEFORE api routes
app.use('/api/auth', authRoute);
app.use('/api/facilities', facilityRoute);
app.use('/api/facility-keys', facilityKeyRoute);
app.use('/api/inventory', inventoryRoute);
app.use('/api/sales', saleRoute);
app.use('/api/alerts', alertRoute);

httpServer.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});

// ─── Background jobs ──────────────────────────────────
setInterval(checkExpiredAlerts, 30 * 60 * 1000);