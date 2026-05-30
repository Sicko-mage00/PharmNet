import express from 'express';
import saleController from '../controllers/sale.js';
import { protect } from '../middleware/auth.js';

const saleRoute = express.Router();

saleRoute.use(protect);

saleRoute.post('/',   saleController.recordSale);
saleRoute.get('/',    saleController.getAllSales);
saleRoute.get('/:id', saleController.getSale);

export default saleRoute;