"""Download every public dataset this project uses.

    ..\\.venv\\Scripts\\python download_data.py            # government data only (small)
    ..\\.venv\\Scripts\\python download_data.py --pan12    # also PAN12 (~91 MB zip, ~600 MB extracted)

PAN12 contains sexually explicit chat text (offenders talking to adult decoys). It is kept in
data/pan12/, which is git-ignored, and no script or API endpoint ever prints or serves its text.
"""
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GOV = ROOT / "data" / "gov"
PAN = ROOT / "data" / "pan12"

UA = {"User-Agent": "Mozilla/5.0 (research download)"}

GOV_FILES = {
    "ncrb_cyber_crimes_against_children_2017_2021.xlsx":
        "https://data.mendeley.com/public-files/datasets/mc7wsp8v9y/files/"
        "53aa2b3f-013f-4c26-a841-909fcc1941be/file_downloaded",
    "ncmec_2019_reports_by_country.pdf":
        "https://www.missingkids.org/content/dam/missingkids/pdfs/2019%20CyberTipline%20Reports%20by%20Country.pdf",
    **{f"ncmec_{y}_reports_by_country.pdf":
       f"https://www.missingkids.org/content/dam/missingkids/pdfs/{y}-reports-by-country.pdf"
       for y in (2020, 2021, 2022, 2023, 2024)},
}

PAN12_ZIP = ("https://zenodo.org/records/3713280/files/"
             "pan12-sexual-predator-identification-test-and-training.zip?download=1")


def fetch(url, dest):
    if dest.exists() and dest.stat().st_size > 0:
        print("exists ", dest.name)
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    print("saved  ", dest.name, f"{dest.stat().st_size / 1e6:.1f} MB")


def main():
    for name, url in GOV_FILES.items():
        fetch(url, GOV / name)
    if "--pan12" in sys.argv:
        z = PAN / "pan12.zip"
        fetch(PAN12_ZIP, z)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(PAN)
        # the archive contains two inner zips (training and test corpora)
        for inner in PAN.glob("pan12-sexual-predator-identification-*.zip"):
            with zipfile.ZipFile(inner) as zf:
                zf.extractall(PAN)
        print("PAN12 extracted to", PAN, "- now run prepare_data.py")


if __name__ == "__main__":
    main()
