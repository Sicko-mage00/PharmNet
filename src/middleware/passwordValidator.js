const validatePassword = (req, res, next) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }
  next();
};

export default validatePassword;