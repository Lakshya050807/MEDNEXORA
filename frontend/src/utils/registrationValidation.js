const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;

export function validateRegistration({ name, email, password, confirmPassword }) {
  const fieldErrors = {};
  const trimmedName = name.trim();
  const normalizedEmail = email.trim();
  const passwordBytes = new TextEncoder().encode(password).length;

  if (!trimmedName) fieldErrors.name = 'Full name is required.';
  else if (trimmedName.length < 2 || trimmedName.length > 80) fieldErrors.name = 'Enter your name using 2 to 80 characters.';

  if (!normalizedEmail) fieldErrors.email = 'Email address is required.';
  else if (!emailPattern.test(normalizedEmail) || normalizedEmail.length > 254) fieldErrors.email = 'Please enter a valid email address.';

  if (!password) fieldErrors.password = 'Password is required.';
  else if ([...password].length < 12) fieldErrors.password = 'Password must be at least 12 characters.';
  else if (passwordBytes > 72) fieldErrors.password = 'Password must be no more than 72 UTF-8 bytes.';

  if (!confirmPassword) fieldErrors.confirmPassword = 'Please confirm your password.';
  else if (confirmPassword !== password) fieldErrors.confirmPassword = 'The passwords do not match.';

  return fieldErrors;
}

export function registrationErrorMessage(error) {
  if (typeof error?.message === 'string' && error.message.trim()) return error.message;
  return 'Something went wrong. Please try again later.';
}
