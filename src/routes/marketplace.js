import express from 'express';
import marketplaceController from '../controllers/marketplace.js';
import { protect } from '../middleware/auth.js';

const marketplaceRoute = express.Router();

marketplaceRoute.use(protect);

marketplaceRoute.post('/',                        marketplaceController.createListing);
marketplaceRoute.get('/',                         marketplaceController.getListings);
marketplaceRoute.get('/mine',                     marketplaceController.getMyListings);
marketplaceRoute.get('/orders/mine',              marketplaceController.getMyOrders);
marketplaceRoute.post('/:id/order',               marketplaceController.placeOrder);
marketplaceRoute.patch('/orders/:orderId/confirm', marketplaceController.confirmOrder);
marketplaceRoute.patch('/orders/:orderId/cancel',  marketplaceController.cancelOrder);
marketplaceRoute.patch('/:id/withdraw',           marketplaceController.withdrawListing);

export default marketplaceRoute;
