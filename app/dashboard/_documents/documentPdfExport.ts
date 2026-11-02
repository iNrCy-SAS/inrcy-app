/** Shared browser PDF export for quote and invoice previews. */
export async function exportDocumentPreviewPdf(
  el: HTMLElement,
  styles: Readonly<Record<string, string>>,
  waitForDomUpdate: () => Promise<void>,
): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const printPages = el.querySelector(`.${styles.documentPrintPages}`) as HTMLElement | null;

  if (printPages) {
    const staging = document.createElement("div");
    staging.className = styles.pdfExportStaging;

    const printPagesClone = printPages.cloneNode(true) as HTMLElement;
    const previewClasses =
      typeof el.className === "string" ? el.className : "";
    printPagesClone.className = `${printPagesClone.className} ${previewClasses}`.trim();
    printPagesClone.removeAttribute("aria-hidden");
    staging.appendChild(printPagesClone);
    document.body.appendChild(staging);

    try {
      await waitForDomUpdate();

      const pageEls = Array.from(
        printPagesClone.querySelectorAll(`.${styles.documentPrintPage}`),
      ) as HTMLElement[];

      if (pageEls.length) {
        for (const [index, pageEl] of pageEls.entries()) {
          const canvas = await html2canvas(pageEl, {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            windowWidth: 794,
            windowHeight: 1123,
          });

          if (index > 0) pdf.addPage();
          pdf.addImage(
            canvas.toDataURL("image/png"),
            "PNG",
            0,
            0,
            pageWidth,
            pageHeight,
          );
        }

        return pdf.output("blob") as Blob;
      }
    } finally {
      staging.remove();
    }
  }

  const hiddenSelector = [
    styles.noPrint,
    styles.printHidden,
    styles.printHiddenCell,
  ]
    .filter(Boolean)
    .map((className) => `.${className}`)
    .join(", ");
  const hiddenEls = hiddenSelector
    ? (Array.from(el.querySelectorAll(hiddenSelector)) as HTMLElement[])
    : [];
  const printOnlyEls = Array.from(
    el.querySelectorAll(`.${styles.printOnly}`),
  ) as HTMLElement[];
  const previousHiddenDisplay = hiddenEls.map((node) => node.style.display);
  const previousPrintOnlyDisplay = printOnlyEls.map(
    (node) => node.style.display,
  );

  hiddenEls.forEach((node) => {
    node.style.display = "none";
  });
  printOnlyEls.forEach((node) => {
    node.style.display = "block";
  });

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
    });
  } finally {
    hiddenEls.forEach((node, index) => {
      node.style.display = previousHiddenDisplay[index] || "";
    });
    printOnlyEls.forEach((node, index) => {
      node.style.display = previousPrintOnlyDisplay[index] || "";
    });
  }

  const imgData = canvas.toDataURL("image/png");
  const imgProps = (pdf as any).getImageProperties(imgData);
  const imgWidth = pageWidth;
  const imgHeight = (imgProps.height * imgWidth) / imgProps.width;

  let position = 0;
  let heightLeft = imgHeight;

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  return pdf.output("blob") as Blob;
}
