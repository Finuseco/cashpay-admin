function renderStaffIdentity(user) {
  const name = user.last_name || user.full_name || "Mon profil";
  document.getElementById("admin-name").textContent = name;
  document.getElementById("staff-last-name").textContent = name;
  for (const [imageId, fallbackId] of [
    ["staff-avatar", "staff-avatar-fallback"],
    ["profile-photo", "profile-photo-fallback"],
  ]) {
    const image = document.getElementById(imageId),
      fallback = document.getElementById(fallbackId);
    image.hidden = true;
    fallback.hidden = false;
    image.onload = () => {
      image.hidden = false;
      fallback.hidden = true;
    };
    image.onerror = () => {
      image.hidden = true;
      fallback.hidden = false;
    };
    if (user.profile_photo) image.src = user.profile_photo;
    else image.removeAttribute("src");
  }
}
function bootStaffProfile() {
  document.getElementById("staff-profile-view").hidden = false;
  const user = state.session.user;
  for (const [id, value] of Object.entries({
    "profile-name":
      [user.first_name, user.last_name].filter(Boolean).join(" ") ||
      user.full_name,
    "profile-wallet": user.id_wallet,
    "profile-email": user.email,
    "profile-role": user.role,
  }))
    document.getElementById(id).textContent = value || "Non renseigné";
  document.getElementById("app-status").textContent =
    "Votre profil professionnel et la sécurité de votre compte CashPay.";
}
let profileBusy = false;
async function profileSubmit(form, task) {
  if (profileBusy) return;
  profileBusy = true;
  const status = document.getElementById("profile-status");
  status.textContent = "Modification en cours…";
  form.setAttribute("aria-busy", "true");
  document
    .querySelectorAll("#staff-profile-view button")
    .forEach((node) => (node.disabled = true));
  try {
    await task();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    form
      .querySelectorAll("input[type=password]")
      .forEach((node) => (node.value = ""));
    profileBusy = false;
    form.setAttribute("aria-busy", "false");
    document
      .querySelectorAll("#staff-profile-view button")
      .forEach((node) => (node.disabled = false));
  }
}
document
  .getElementById("profile-avatar-form")
  .addEventListener("submit", (event) => {
    event.preventDefault();
    void profileSubmit(event.currentTarget, async () => {
      const file = document.getElementById("profile-avatar-file").files[0];
      if (
        !file ||
        !["image/jpeg", "image/png"].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      )
        throw Error("Choisissez une photo JPEG/PNG de 5 Mo maximum.");
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Error("Photo illisible."));
        reader.readAsDataURL(file);
      });
      const uploaded = await api("/api/registration/media", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": state.session.csrf,
        },
        body: JSON.stringify({ purpose: "avatar", data }),
      });
      await api("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": state.session.csrf,
        },
        body: JSON.stringify({
          action: "avatar",
          avatar_id: uploaded.id,
          current_pin: document.getElementById("profile-avatar-pin").value,
        }),
      });
      state.session = await api("/api/session");
      renderStaffIdentity(state.session.user);
      document.getElementById("profile-status").textContent =
        "Photo mise à jour. Une alerte de sécurité a été enregistrée.";
      document.getElementById("profile-avatar-file").value = "";
    });
  });
document
  .getElementById("profile-pin-form")
  .addEventListener("submit", (event) => {
    event.preventDefault();
    void profileSubmit(event.currentTarget, async () => {
      await api("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": state.session.csrf,
        },
        body: JSON.stringify({
          action: "pin",
          current_pin: document.getElementById("profile-current-pin").value,
          new_pin: document.getElementById("profile-new-pin").value,
          confirm_pin: document.getElementById("profile-confirm-pin").value,
        }),
      });
      location.replace("/login");
    });
  });
