// Room IDs are secret capabilities issued only after /api/lobby validates an invitation.
// No client may create, read, or alter persistent namespaces in this app.
export default {
  $default: { allow: { $default: 'false' } },
  attrs: { allow: { $default: 'false' } },
  $users: { allow: { view: 'auth.id == data.id', create: 'false', update: 'false', delete: 'false' } },
};
