let io;

export const initSocket = (socketIo) => {
  io = socketIo;

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('join_facility', (facility_id) => {
      socket.join(facility_id);
      console.log(`Socket ${socket.id} joined facility room: ${facility_id}`);
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
};

// ─── GET IO ────────────────────────────────────────────
// exported so controllers can emit directly when needed
export const getIO = () => io;

// ─── EMIT ALERT ────────────────────────────────────────
export const emitAlert = (alert, matched) => {
  if (!io) return;

  const source = alert.source_facility.toString();
  const target = alert.target_facility.toString();

  if (matched) {
    io.to(target).emit('new_alert', {
      message: `New ${alert.type} alert — ${alert.drug_name}`,
      alert,
    });

    if (source !== target) {
      io.to(source).emit('new_alert', {
        message: `You have been matched as a supplier for ${alert.drug_name}`,
        alert,
      });
    }
  } else {
    io.to(target).emit('new_alert', {
      message: `${alert.type} alert — ${alert.drug_name}. No network match found.`,
      alert,
    });
  }
};