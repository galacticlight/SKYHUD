// SKYHUD share card: the dome canvas plus a caption, made and saved on the device (blob download, no upload).
// Loaded on the first click of "Save PNG" so this code isn't parsed during page load.
export function savePng({ $, state, canvas, viewTime, dayHm, tzLabel, status }) {
  const t = viewTime(), body = getComputedStyle(document.body);
  const w = canvas.width;
  const gl = [...document.querySelectorAll("#glance .glance-i")].slice(0, 2).map((d) => `${d.querySelector("dt").textContent}: ${d.querySelector("dd").textContent}`.replace(/\s+/g, " ").trim());
  const lines = [`SKYHUD${$("png-place").checked ? ` · ${state.loc.name}` : ""} · ${dayHm(t)} ${tzLabel()}`, ...gl, `Moon: ${$("dome-moon").textContent}`,
    gl.length ? "Score from the Open-Meteo forecast (CC BY 4.0); sky computed with Astronomy Engine." : "Sky computed on the device with Astronomy Engine."];
  const W = Math.max(720, w), P = Math.round(W * 0.04), F = Math.round(W / 34), LH = F * 1.45;
  const out = document.createElement("canvas"), g = out.getContext("2d");
  const wrap = (text, font) => { // greedy word wrap to the card width
    g.font = font; const rows = []; let cur = "";
    for (const word of text.split(" ")) { const next = cur ? `${cur} ${word}` : word; if (cur && g.measureText(next).width > W - P * 2) { rows.push(cur); cur = word; } else cur = next; }
    return rows.concat(cur);
  };
  const rows = lines.flatMap((l, i) => { const font = `${i ? "" : "bold "}${i === lines.length - 1 ? Math.round(F * 0.8) : F}px system-ui, sans-serif`; return wrap(l, font).map((r) => [r, font]); });
  out.width = W; out.height = W + P * 2 + rows.length * LH;
  g.fillStyle = body.backgroundColor || "#000"; g.fillRect(0, 0, out.width, out.height);
  g.drawImage(canvas, 0, 0, W, W);
  g.fillStyle = body.color || "#fff"; g.textBaseline = "top";
  rows.forEach(([r, font], i) => { g.font = font; g.fillText(r, P, W + P + i * LH); });
  out.toBlob((blob) => {
    if (!blob) { status("Couldn't make the image in this browser."); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `skyhud-${t.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-")}Z.png`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10e3);
  }, "image/png");
}
