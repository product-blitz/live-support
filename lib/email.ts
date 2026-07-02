import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function sendCustomerInvite(opts: {
  to: string;
  customerName: string;
  pin: string;
  joinUrl: string;
}) {
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;">
      <h2 style="margin:0 0 12px 0;">Support session ready</h2>
      <p>Hi ${opts.customerName || "there"},</p>
      <p>Click the link below and enter the PIN when prompted to connect with a support agent.</p>
      <p style="margin:24px 0;">
        <a href="${opts.joinUrl}"
           style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">
          Join support session
        </a>
      </p>
      <p style="font-size:16px;">Your PIN: <b style="font-size:22px;letter-spacing:4px;">${opts.pin}</b></p>
      <p style="color:#666;font-size:12px;">This link expires in 24 hours.</p>
    </div>
  `;

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: opts.to,
    subject: "Your support session link",
    html,
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}
