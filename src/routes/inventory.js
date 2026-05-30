import express from 'express';
import inventoryController from '../controllers/inventory.js';
import { protect, restrictTo } from '../middleware/auth.js';

const inventoryRoute = express.Router();

// all inventory routes require login and verified facility
inventoryRoute.use(protect);

inventoryRoute.post('/',          inventoryController.addDrug);
inventoryRoute.get('/',           inventoryController.getAllDrugs);
inventoryRoute.get('/:id',        inventoryController.getDrug);
inventoryRoute.patch('/:id',      inventoryController.updateDrug);
inventoryRoute.delete('/:id',     inventoryController.deactivateDrug);
inventoryRoute.post('/:id/batch', inventoryController.addBatch);

export default inventoryRoute;