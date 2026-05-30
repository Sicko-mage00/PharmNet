import express from 'express';
const viewRoute = express.Router();

viewRoute.get('/',         (req, res) => res.redirect('/login'));
viewRoute.get('/login',    (req, res) => res.render('login',    { title: 'Login' }));
viewRoute.get('/register', (req, res) => res.render('register', { title: 'Register' }));
viewRoute.get('/verify',   (req, res) => res.render('verify',   { title: 'Verify Facility' }));

// pass user: true so layout shows the sidebar
viewRoute.get('/dashboard',      (req, res) => res.render('dashboard',      { title: 'Dashboard',      user: true }));
viewRoute.get('/inventory',      (req, res) => res.render('inventory',      { title: 'Inventory',      user: true }));
viewRoute.get('/inventory/add',  (req, res) => res.render('inventoryAdd',   { title: 'Add Drug',       user: true }));
viewRoute.get('/inventory/:id',  (req, res) => res.render('inventoryDetail',{ title: 'Drug Detail',    user: true }));
viewRoute.get('/sales',          (req, res) => res.render('sales',          { title: 'Sales History',  user: true }));
viewRoute.get('/sales/new',      (req, res) => res.render('salesNew',       { title: 'Record Sale',    user: true }));
viewRoute.get('/alerts',         (req, res) => res.render('alerts',         { title: 'Alerts',         user: true }));
viewRoute.get('/profile',        (req, res) => res.render('profile',        { title: 'Profile',        user: true }));
viewRoute.get('/facilities',     (req, res) => res.render('facilities',     { title: 'Facilities',     user: true }));
viewRoute.get('/facilities/new', (req, res) => res.render('facilitiesNew',  { title: 'Add Facility',   user: true }));
viewRoute.get('/keys',           (req, res) => res.render('keys',           { title: 'Keys',           user: true }));
viewRoute.get('/scan',           (req, res) => res.render('scan',           { title: 'Scan Drug',      user: true }));
viewRoute.get('/admin',          (req, res) => res.render('adminSetup',     { title: 'Admin Setup',    user: true }));

export default viewRoute;