import express from 'express';
const router = express.Router();

// ─── Public ───────────────────────────────────────────
router.get('/',          (req, res) => res.redirect('/login'));
router.get('/login',     (req, res) => res.render('login',    { title: 'Login' }));
router.get('/register',  (req, res) => res.render('register', { title: 'Register' }));
router.get('/verify',    (req, res) => res.render('verify',   { title: 'Verify Facility' }));

// ─── Super admin pages ────────────────────────────────
router.get('/admin',              (req, res) => res.render('adminOverview',   { title: 'Overview',   user: { role: 'super_admin' } }));
router.get('/admin/facilities',   (req, res) => res.render('adminFacilities', { title: 'Facilities', user: { role: 'super_admin' } }));
router.get('/admin/keys',         (req, res) => res.render('adminKeys',       { title: 'Keys',       user: { role: 'super_admin' } }));
router.get('/admin/users',        (req, res) => res.render('adminUsers',      { title: 'Users',      user: { role: 'super_admin' } }));

// ─── Pharmacist / facility admin pages ───────────────
router.get('/dashboard',      (req, res) => res.render('dashboard',       { title: 'Dashboard',   user: true }));
router.get('/inventory',      (req, res) => res.render('inventory',       { title: 'Inventory',   user: true }));
router.get('/inventory/add',  (req, res) => res.render('inventoryAdd',    { title: 'Add Drug',    user: true }));
router.get('/inventory/:id',  (req, res) => res.render('inventoryDetail', { title: 'Drug Detail', user: true }));
router.get('/sales',          (req, res) => res.render('sales',           { title: 'Sales',       user: true }));
router.get('/sales/new',      (req, res) => res.render('salesNew',        { title: 'Record Sale', user: true }));
router.get('/scan',           (req, res) => res.render('scan',            { title: 'Scan Drug',   user: true }));
router.get('/alerts',         (req, res) => res.render('alerts',          { title: 'Alerts',      user: true }));
router.get('/profile',        (req, res) => res.render('profile',         { title: 'Profile',     user: true }));

export default router;