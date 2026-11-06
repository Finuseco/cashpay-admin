document
  .getElementById("print-certificate")
  .addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await Promise.all([...document.images].map((image) => image.decode()));
      window.print();
    } catch {
      document.getElementById("certificate-error").textContent =
        "Une photo ou signature est indisponible. Rechargez avant d’imprimer.";
    } finally {
      button.disabled = false;
    }
  });
