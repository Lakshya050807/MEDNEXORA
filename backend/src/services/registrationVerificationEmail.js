export const registrationVerificationSubject = 'Verify your MEDNEXORA email address';

export function registrationVerificationEmail(otp) {
  if (typeof otp !== 'string' || !/^\d{6}$/u.test(otp)) {
    throw new TypeError('A six-digit registration code is required.');
  }

  const text = [
    'MEDNEXORA email verification',
    '',
    'You requested to create a MEDNEXORA student account.',
    `Your verification code is ${otp}.`,
    'This code expires in 10 minutes. Do not share it with anyone.',
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:24px;background:#f7f5ec;font-family:Arial,Helvetica,sans-serif;color:#10251c">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#fffefa;border:1px solid rgba(8,37,27,.12);border-radius:14px;overflow:hidden">
      <tr><td style="padding:22px 26px;background:#031a14;color:#f7f5ec;border-bottom:3px solid #dda91e">
        <div style="font-size:12px;letter-spacing:2px;color:#f5c94a">MEDNEXORA</div>
        <h1 style="margin:9px 0 0;font-size:23px;line-height:1.3">Verify your email address</h1>
      </td></tr>
      <tr><td style="padding:26px">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7">You requested to create a MEDNEXORA student account. Enter this verification code to continue:</p>
        <p style="margin:20px 0;padding:16px;border:1px solid rgba(221,169,30,.45);border-radius:10px;background:#fbf6e5;text-align:center;color:#031a14;font-size:32px;font-weight:700;letter-spacing:8px">${otp}</p>
        <p style="margin:0 0 12px;font-size:14px;line-height:1.7">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
        <p style="margin:0;color:#596a60;font-size:13px;line-height:1.7">If you did not request registration, ignore this email. No account will be created unless the verification is completed.</p>
      </td></tr>
      <tr><td style="padding:15px 26px;border-top:1px solid rgba(8,37,27,.12);color:#596a60;font-size:12px">MEDNEXORA student account verification</td></tr>
    </table>
  </body>
</html>`;

  return { subject: registrationVerificationSubject, text, html };
}
