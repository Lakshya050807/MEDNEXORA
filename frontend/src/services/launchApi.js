export async function getLaunchStatus() {
  let response;
  try {
    response = await fetch('/api/launch/status', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new Error('Launch availability could not be checked.');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || typeof payload !== 'object' || payload === null) {
    throw new Error('Launch availability could not be checked.');
  }

  return {
    registrationEnabled: payload.registrationEnabled === true,
    paidPurchasesEnabled: payload.paidPurchasesEnabled === true,
  };
}

export const launchApi = { getStatus: getLaunchStatus };
