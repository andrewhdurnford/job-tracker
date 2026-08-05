const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Email a digest of new postings. Optional by construction: with no
 * RESEND_API_KEY this is a no-op and the poller carries on.
 *
 * Never throws — a mail outage must not fail the run, or the data commit is
 * skipped and the next poll re-reports the same jobs as new.
 */
export async function sendDigest(newJobs, { bootstrap } = {}) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM || "onboarding@resend.dev";

  if (newJobs.length === 0) return { sent: false, reason: "no new jobs" };
  if (bootstrap) return { sent: false, reason: "bootstrap run" };
  if (!apiKey || !to) return { sent: false, reason: "email not configured" };

  const subject =
    newJobs.length === 1
      ? `New job: ${newJobs[0].title} @ ${newJobs[0].company}`
      : `${newJobs.length} new jobs`;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: to.split(",").map((s) => s.trim()),
        subject,
        html: renderHtml(newJobs),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, reason: `HTTP ${res.status} ${body.slice(0, 200)}` };
    }
    return { sent: true, count: newJobs.length };
  } catch (err) {
    return { sent: false, reason: `send failed: ${err.message}` };
  }
}

function renderHtml(jobs) {
  const byCompany = new Map();
  for (const job of jobs) {
    if (!byCompany.has(job.company)) byCompany.set(job.company, []);
    byCompany.get(job.company).push(job);
  }

  const sections = [...byCompany.entries()]
    .map(([company, list]) => {
      const items = list
        .map((j) => {
          const where = j.location ? ` — ${escapeHtml(j.location)}` : "";
          const link = j.url
            ? `<a href="${escapeHtml(j.url)}">${escapeHtml(j.title)}</a>`
            : escapeHtml(j.title);
          // Only tag the levels worth calling out; "experienced" is the default
          // and tagging every line with it is noise.
          const tags = [
            j.level && j.level !== "experienced" ? j.level : null,
            j.term?.label ?? null,
          ].filter(Boolean);
          const tag =
            tags.length > 0
              ? ` <span style="font-size:12px;color:#047857">[${escapeHtml(tags.join(" · "))}]</span>`
              : "";
          return `<li style="margin:6px 0">${link}${tag}${where}</li>`;
        })
        .join("");
      return `<h3 style="margin:18px 0 4px">${escapeHtml(company)}</h3><ul style="margin:0;padding-left:20px">${items}</ul>`;
    })
    .join("");

  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5">
<p style="margin:0 0 4px"><strong>${jobs.length} new posting${jobs.length === 1 ? "" : "s"}</strong></p>
${sections}
</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
