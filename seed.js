import 'dotenv/config';
import mongoose from 'mongoose';
import User from './src/models/user.js';

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const superAdmin = await User.findOne({ email: 'okepeter83@gmail.com' });

  if (superAdmin) {
    console.log('Super Admin already exists');
    return process.exit();
  }
  
  await User.create({
    firstName: "Peter",
    lastName: 'Oke',
    email: 'okepeter83@gmail.com',
    password: 'sicko-mage00#',
    role: 'super_admin'
  });
  console.log('Super Admin seeded');
  process.exit();
});
