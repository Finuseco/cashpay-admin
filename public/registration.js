let registrationStep = 0,
  registrationUploads = 0,
  registrationBusy = false;
const registrationMedia = {};
function registrationShow(step) {
  registrationStep = step;
  document
    .querySelectorAll("[data-registration-step]")
    .forEach(
      (node) => (node.hidden = Number(node.dataset.registrationStep) !== step),
    );
  for (let index = 0; index < 4; index++)
    $("registration-step-label-" + index).classList.toggle(
      "active",
      index === step,
    );
  $("registration-prev").hidden = step === 0;
  $("registration-next").hidden = step === 3;
  $("create-user-submit").hidden = step !== 3;
  if (step === 3) {
    const review = $("registration-review");
    review.replaceChildren();
    for (const [key, value] of new FormData($("create-user-form"))) {
      if (value && key !== "pin")
        review.append(
          element(
            "dt",
            $("create-user-form").querySelector(`[name="${key}"]`)?.labels?.[0]
              ?.textContent || key,
            "col-sm-4",
          ),
          element(
            "dd",
            key === "countryCode"
              ? $("create-country").selectedOptions[0]?.textContent
              : value,
            "col-sm-8",
          ),
        );
    }
    review.append(
      element("dt", "Documents", "col-sm-4"),
      element("dd", Object.keys(registrationMedia).join(", "), "col-sm-8"),
    );
  }
}
function registrationValidate(step) {
  const section = document.querySelector(`[data-registration-step="${step}"]`);
  for (const input of section.querySelectorAll(
    "input:not([type=file]),select,textarea",
  ))
    if (!input.checkValidity()) {
      registrationShow(step);
      input.reportValidity();
      return false;
    }
  if (
    step === 2 &&
    ["avatar", "signature", "id_front"].some((key) => !registrationMedia[key])
  ) {
    $("create-user-result").textContent =
      "Ajoutez la photo, la signature et le recto de la pièce.";
    return false;
  }
  return true;
}
async function registrationUpload(file, purpose) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    $("preview-" + purpose).textContent = "Fichier limité à 5 Mo.";
    return;
  }
  registrationUploads++;
  $("registration-next").disabled = true;
  $("create-user-submit").disabled = true;
  $("preview-" + purpose).textContent = "Enregistrement du fichier…";
  try {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(Error("Lecture du fichier impossible."));
      reader.readAsDataURL(file);
    });
    const result = await api("/api/registration/media", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": state.session.csrf,
      },
      body: JSON.stringify({ purpose, data }),
      timeoutMs: 45000,
    });
    registrationMedia[purpose] = result.id;
    const preview = $("preview-" + purpose);
    preview.replaceChildren(element("p", "Fichier enregistré", "text-success"));
    if (file.type.startsWith("image/")) {
      const img = element("img", null, "img-fluid rounded");
      img.src = result.url;
      img.alt = "Aperçu du fichier recueilli";
      img.width = 180;
      preview.append(img);
    } else {
      const link = element("a", "Consulter le document");
      link.href = result.url;
      link.target = "_blank";
      link.rel = "noopener";
      preview.append(link);
    }
  } catch (error) {
    delete registrationMedia[purpose];
    $("preview-" + purpose).textContent = error.message;
  } finally {
    registrationUploads--;
    $("registration-next").disabled = registrationUploads > 0;
    $("create-user-submit").disabled = registrationUploads > 0;
  }
}
document
  .querySelectorAll("[data-media-purpose]")
  .forEach((input) =>
    input.addEventListener(
      "change",
      () => void registrationUpload(input.files[0], input.dataset.mediaPurpose),
    ),
  );
$("registration-next").addEventListener("click", () => {
  if (!registrationUploads && registrationValidate(registrationStep))
    registrationShow(Math.min(3, registrationStep + 1));
});
$("registration-prev").addEventListener("click", () =>
  registrationShow(Math.max(0, registrationStep - 1)),
);
$("create-user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (registrationBusy || registrationUploads) return;
  for (let step = 0; step < 4; step++) if (!registrationValidate(step)) return;
  registrationBusy = true;
  const result = $("create-user-result");
  result.textContent = "Enregistrement du compte et envoi des notifications…";
  $("create-user-submit").disabled = true;
  const form = event.currentTarget;
  const body = {
    ...Object.fromEntries(new FormData(form)),
    media: { ...registrationMedia },
    consent: true,
  };
  try {
    const data = await api("/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": state.session.csrf,
      },
      body: JSON.stringify(body),
      timeoutMs: 65000,
    });
    form.hidden = true;
    result.replaceChildren(
      element(
        "p",
        `Compte créé : ${data.user.full_name} — ${data.user.id_wallet}`,
        "text-success",
      ),
    );
    const labels = {
      accepted: "remis au service d’envoi",
      failed: "échec d’envoi",
      unconfirmed: "envoi non confirmé",
      not_configured: "non configuré",
    };
    for (const [channel, status] of Object.entries(
      data.user.notifications || {},
    ))
      result.append(
        element(
          "p",
          `${channel} : ${labels[status] || status}`,
          status === "accepted" ? "text-success" : "text-warning",
        ),
      );
    if (data.user.notifications?.email !== "accepted")
      result.append(
        element(
          "p",
          "Le compte existe, mais l’envoi du PIN par e-mail a échoué. Utilisez la procédure Cashpay de récupération du PIN ; ne recréez pas le compte.",
          "text-warning",
        ),
      );
    if (!data.user.notificationAudit)
      result.append(
        element(
          "p",
          "Le suivi des notifications n’a pas pu être journalisé.",
          "text-warning",
        ),
      );
    for (const [label, href] of [
      ["Consulter le compte", "/users/" + data.user.id],
      ["Certificat A4", "/users/" + data.user.id + "/certificate"],
      ["Historique", "/registrations"],
    ]) {
      const link = element("a", label, "btn btn-outline-primary me-2 mt-2");
      link.href = href;
      result.append(link);
    }
  } catch (error) {
    result.textContent =
      error.message +
      " Après une interruption réseau, recherchez le compte avant de réessayer.";
  } finally {
    registrationBusy = false;
    $("create-user-submit").disabled = false;
  }
});
const signatureCanvas = $("signature-canvas"),
  signatureContext = signatureCanvas.getContext("2d");
let signatureDrawing = false,
  signaturePresent = false;
function signaturePoint(event) {
  const bounds = signatureCanvas.getBoundingClientRect();
  return [
    ((event.clientX - bounds.left) * signatureCanvas.width) / bounds.width,
    ((event.clientY - bounds.top) * signatureCanvas.height) / bounds.height,
  ];
}
signatureContext.strokeStyle = "#000";
signatureContext.lineWidth = 2;
signatureCanvas.addEventListener("pointerdown", (event) => {
  signatureDrawing = true;
  signaturePresent = true;
  signatureCanvas.setPointerCapture(event.pointerId);
  signatureContext.beginPath();
  signatureContext.moveTo(...signaturePoint(event));
});
signatureCanvas.addEventListener("pointermove", (event) => {
  if (signatureDrawing) {
    signatureContext.lineTo(...signaturePoint(event));
    signatureContext.stroke();
  }
});
for (const event of ["pointerup", "pointercancel"])
  signatureCanvas.addEventListener(event, () => (signatureDrawing = false));
$("signature-clear").addEventListener("click", () => {
  signatureContext.clearRect(0, 0, 600, 180);
  signaturePresent = false;
});
$("signature-use").addEventListener("click", () => {
  if (!signaturePresent) {
    $("preview-signature").textContent =
      "Dessinez d’abord la signature du titulaire.";
    return;
  }
  signatureCanvas.toBlob(
    (blob) =>
      void registrationUpload(
        new File([blob], "signature.png", { type: "image/png" }),
        "signature",
      ),
    "image/png",
  );
});
registrationShow(0);
