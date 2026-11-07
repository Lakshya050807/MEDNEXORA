export function toStudentProfile(user) {
  return {
    id: user.id ?? user._id?.toString(),
    name: user.name,
    email: user.email,
    createdAt: user.createdAt ?? null,
  };
}
