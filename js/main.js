import "../css/style.css";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.min.js";
import "@ui5/webcomponents/dist/FileUploader.js";
import "@ui5/webcomponents/dist/Button.js";
import "@ui5/webcomponents/dist/TabContainer.js";
import "@ui5/webcomponents/dist/Tab.js";
import "@ui5/webcomponents-icons/dist/download.js";

import convert from "./convert.js";
import util from "./util.js";

const fileUploader = document.querySelector("#fp"),
      resultDiv = document.querySelector("#result1"),
      tabContainer = document.querySelector("#tabContainer");

let iCanvas = 0,
    sFileName = "",
    aDxfContent = [];

let getDxfName = (sName, sCanvas) => {
    return `${sName.slice(0, -4)}_${sCanvas.replaceAll(" ", "_")}.dxf`;
};

fileUploader.addEventListener("change", event => {
    const oFile = event.target.files[0];

    if (!oFile) {
        resultDiv.innerHTML = "No file selected";
    } else {
        resultDiv.innerHTML = "";
        oFile.text().then(sContent => {
            let oJSON;
            try {
                oJSON = JSON.parse(sContent);
            } catch (e) {

            }
            if (oJSON) {
                let oProcessed = convert.toSVG(oJSON),
                    oDxf = convert.toDXF(oJSON),
                    a = [];

                sFileName = oFile.name;
                aDxfContent = oDxf.aCanvas.map(oCanvas => oCanvas.dxf);

                oProcessed.aCanvas.forEach((oCanvas, i) => {
                    a.push(`<ui5-tab text="${oCanvas.title}" ${i === 0 ? "selected" : ""}>
                              <ui5-button id="button_${i}" class="download" icon-end design="Positive" icon="download">Download</ui5-button>
                              <p class="file_name text-muted text-secondary mt-2">File name: <span id="file_name_${i}">${getDxfName(oFile.name, oCanvas.title)}</span></p>
                              <div id="result${i}" class="result">${oCanvas.svg}</div>
                            </ui5-tab>`);
                });

                iCanvas = oProcessed.aCanvas.length;

                document.getElementById("download_zip").classList.toggle("hide", !(oProcessed.aCanvas.length > 1));

                tabContainer.innerHTML = a.join("");

                document.getElementById("tabContainer").classList.remove("hide");
            }
        });
    }
});

document.getElementById("tab_container").addEventListener("click", e => {
    if (e.target.tagName !== "UI5-BUTTON") {
        return;
    }

    let sID = e.target.id.split("_").pop(),
        sDXF = aDxfContent[sID],
        sFile = document.getElementById(`file_name_${sID}`).innerText;

    let blob = new Blob([sDXF], {
        type: "application/dxf",
    });

    util.downloadBlob(blob, sFile);

    gtag('event', "Download regular");
});

document.getElementById("download_zip").addEventListener("click", e => {
    let aFiles = [];

    for (let i = 0;i < iCanvas;i++) {
        let sDXF = aDxfContent[i],
            sFile = document.getElementById(`file_name_${i}`).innerText;

        aFiles.push({
            blob: new Blob([sDXF], {
                type: "application/dxf",
            }),
            file: sFile
        });
    }

    util.downloadAsZip(aFiles, sFileName.slice(0, -4) + ".zip");

    gtag('event', "Download zip");
});