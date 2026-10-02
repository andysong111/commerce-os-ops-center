import argparse
import ctypes
import json
import os
import subprocess
import sys
import tempfile
from ctypes import wintypes
from pathlib import Path

from PIL import Image, ImageWin
from pypdf import PdfReader


DM_ORIENTATION = 0x00000001
DM_PAPERSIZE = 0x00000002
DM_PAPERLENGTH = 0x00000004
DM_PAPERWIDTH = 0x00000008
DM_FORMNAME = 0x00010000
DM_IN_BUFFER = 8
DM_OUT_BUFFER = 2
DMORIENT_PORTRAIT = 1
IDOK = 1
PHYSICALWIDTH = 110
PHYSICALHEIGHT = 111
PHYSICALOFFSETX = 112
PHYSICALOFFSETY = 113
HORZRES = 8
VERTRES = 10
LOGPIXELSX = 88
LOGPIXELSY = 90
DC_PAPERS = 2
DC_PAPERSIZE = 3
DC_PAPERNAMES = 16


class SIZEL(ctypes.Structure):
    _fields_ = [("cx", wintypes.LONG), ("cy", wintypes.LONG)]


class RECTL(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


class FORM_INFO_1W(ctypes.Structure):
    _fields_ = [
        ("Flags", wintypes.DWORD),
        ("pName", wintypes.LPWSTR),
        ("Size", SIZEL),
        ("ImageableArea", RECTL),
    ]


class POINTL(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]


class DEVMODE_PRINT(ctypes.Structure):
    _fields_ = [
        ("dmOrientation", ctypes.c_short),
        ("dmPaperSize", ctypes.c_short),
        ("dmPaperLength", ctypes.c_short),
        ("dmPaperWidth", ctypes.c_short),
        ("dmScale", ctypes.c_short),
        ("dmCopies", ctypes.c_short),
        ("dmDefaultSource", ctypes.c_short),
        ("dmPrintQuality", ctypes.c_short),
    ]


class DEVMODE_UNION1(ctypes.Union):
    _anonymous_ = ("print",)
    _fields_ = [("print", DEVMODE_PRINT), ("position", POINTL)]


class DEVMODE_UNION2(ctypes.Union):
    _fields_ = [("dmDisplayFlags", wintypes.DWORD), ("dmNup", wintypes.DWORD)]


class DEVMODEW(ctypes.Structure):
    _anonymous_ = ("u1", "u2")
    _fields_ = [
        ("dmDeviceName", wintypes.WCHAR * 32),
        ("dmSpecVersion", wintypes.WORD),
        ("dmDriverVersion", wintypes.WORD),
        ("dmSize", wintypes.WORD),
        ("dmDriverExtra", wintypes.WORD),
        ("dmFields", wintypes.DWORD),
        ("u1", DEVMODE_UNION1),
        ("dmColor", ctypes.c_short),
        ("dmDuplex", ctypes.c_short),
        ("dmYResolution", ctypes.c_short),
        ("dmTTOption", ctypes.c_short),
        ("dmCollate", ctypes.c_short),
        ("dmFormName", wintypes.WCHAR * 32),
        ("dmLogPixels", wintypes.WORD),
        ("dmBitsPerPel", wintypes.DWORD),
        ("dmPelsWidth", wintypes.DWORD),
        ("dmPelsHeight", wintypes.DWORD),
        ("u2", DEVMODE_UNION2),
        ("dmDisplayFrequency", wintypes.DWORD),
        ("dmICMMethod", wintypes.DWORD),
        ("dmICMIntent", wintypes.DWORD),
        ("dmMediaType", wintypes.DWORD),
        ("dmDitherType", wintypes.DWORD),
        ("dmReserved1", wintypes.DWORD),
        ("dmReserved2", wintypes.DWORD),
        ("dmPanningWidth", wintypes.DWORD),
        ("dmPanningHeight", wintypes.DWORD),
    ]


class DOCINFOW(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.c_int),
        ("lpszDocName", wintypes.LPCWSTR),
        ("lpszOutput", wintypes.LPCWSTR),
        ("lpszDatatype", wintypes.LPCWSTR),
        ("fwType", wintypes.DWORD),
    ]


def pdf_metadata(path: Path):
    reader = PdfReader(str(path))
    pages = []
    for page in reader.pages:
        width_mm = float(page.mediabox.width) * 25.4 / 72
        height_mm = float(page.mediabox.height) * 25.4 / 72
        pages.append((round(width_mm, 2), round(height_mm, 2)))
    return {"pageCount": len(pages), "pageSizesMm": sorted(set(pages))}


def assert_label_page_sizes(page_sizes):
    if not page_sizes:
        raise RuntimeError("PDF contains no pages.")
    invalid = [
        size for size in page_sizes
        if abs(size[0] - 109) > 0.5 or abs(size[1] - 127) > 0.5
    ]
    if invalid:
        raise RuntimeError(f"Unexpected PDF page size: {page_sizes}")


def open_printer_and_forms(printer_name: str):
    winspool = ctypes.WinDLL("winspool.drv", use_last_error=True)
    winspool.OpenPrinterW.argtypes = [wintypes.LPWSTR, ctypes.POINTER(wintypes.HANDLE), wintypes.LPVOID]
    winspool.OpenPrinterW.restype = wintypes.BOOL
    winspool.ClosePrinter.argtypes = [wintypes.HANDLE]
    winspool.ClosePrinter.restype = wintypes.BOOL
    winspool.EnumFormsW.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPBYTE,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
        ctypes.POINTER(wintypes.DWORD),
    ]
    winspool.EnumFormsW.restype = wintypes.BOOL
    handle = wintypes.HANDLE()
    if not winspool.OpenPrinterW(printer_name, ctypes.byref(handle), None):
        raise ctypes.WinError(ctypes.get_last_error())
    needed = wintypes.DWORD()
    returned = wintypes.DWORD()
    winspool.EnumFormsW(handle, 1, None, 0, ctypes.byref(needed), ctypes.byref(returned))
    if not needed.value:
        winspool.ClosePrinter(handle)
        raise RuntimeError("Printer exposes no paper forms.")
    buffer = ctypes.create_string_buffer(needed.value)
    if not winspool.EnumFormsW(
        handle,
        1,
        ctypes.cast(buffer, wintypes.LPBYTE),
        needed.value,
        ctypes.byref(needed),
        ctypes.byref(returned),
    ):
        winspool.ClosePrinter(handle)
        raise ctypes.WinError(ctypes.get_last_error())
    forms = []
    array = ctypes.cast(buffer, ctypes.POINTER(FORM_INFO_1W))
    for index in range(returned.value):
        form = array[index]
        forms.append({
            "name": form.pName,
            "widthMm": round(form.Size.cx / 1000, 2),
            "heightMm": round(form.Size.cy / 1000, 2),
        })
    return winspool, handle, forms


def device_capability_papers(winspool, printer_name: str):
    winspool.DeviceCapabilitiesW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.LPCWSTR,
        wintypes.WORD,
        wintypes.LPVOID,
        wintypes.LPVOID,
    ]
    winspool.DeviceCapabilitiesW.restype = ctypes.c_int
    count = winspool.DeviceCapabilitiesW(printer_name, None, DC_PAPERNAMES, None, None)
    if count <= 0:
        return []
    names = (wintypes.WCHAR * (count * 64))()
    codes = (wintypes.WORD * count)()
    sizes = (POINTL * count)()
    if winspool.DeviceCapabilitiesW(printer_name, None, DC_PAPERNAMES, names, None) != count:
        return []
    if winspool.DeviceCapabilitiesW(printer_name, None, DC_PAPERS, codes, None) != count:
        return []
    if winspool.DeviceCapabilitiesW(printer_name, None, DC_PAPERSIZE, sizes, None) != count:
        return []
    papers = []
    for index in range(count):
        start = index * 64
        name = "".join(names[start:start + 64]).split("\0", 1)[0].strip()
        papers.append({
            "name": name,
            "code": int(codes[index]),
            "widthMm": round(sizes[index].x / 10, 2),
            "heightMm": round(sizes[index].y / 10, 2),
        })
    return papers


def create_printer_dc(winspool, handle, printer_name: str, paper, width_mm: float, height_mm: float):
    winspool.DocumentPropertiesW.argtypes = [
        wintypes.HWND,
        wintypes.HANDLE,
        wintypes.LPWSTR,
        wintypes.LPVOID,
        wintypes.LPVOID,
        wintypes.DWORD,
    ]
    winspool.DocumentPropertiesW.restype = wintypes.LONG
    size = winspool.DocumentPropertiesW(None, handle, printer_name, None, None, 0)
    if size <= 0:
        raise RuntimeError("Could not read printer DEVMODE.")
    buffer = ctypes.create_string_buffer(size)
    result = winspool.DocumentPropertiesW(None, handle, printer_name, buffer, None, DM_OUT_BUFFER)
    if result != IDOK:
        raise RuntimeError(f"Could not initialize printer DEVMODE: {result}")
    devmode = ctypes.cast(buffer, ctypes.POINTER(DEVMODEW)).contents
    devmode.dmFields |= DM_ORIENTATION
    devmode.dmOrientation = DMORIENT_PORTRAIT
    if paper:
        devmode.dmFields |= DM_PAPERSIZE | DM_PAPERLENGTH | DM_PAPERWIDTH | DM_FORMNAME
        devmode.dmPaperSize = paper["code"]
        devmode.dmPaperLength = round(height_mm * 10)
        devmode.dmPaperWidth = round(width_mm * 10)
        devmode.dmFormName = paper["name"]
    else:
        devmode.dmFields |= DM_PAPERLENGTH | DM_PAPERWIDTH
        devmode.dmFields &= ~(DM_PAPERSIZE | DM_FORMNAME)
        devmode.dmPaperLength = round(height_mm * 10)
        devmode.dmPaperWidth = round(width_mm * 10)
    validated_buffer = ctypes.create_string_buffer(size)
    result = winspool.DocumentPropertiesW(
        None,
        handle,
        printer_name,
        validated_buffer,
        buffer,
        DM_IN_BUFFER | DM_OUT_BUFFER,
    )
    if result != IDOK:
        raise RuntimeError(f"Printer rejected label DEVMODE: {result}")
    gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
    gdi32.CreateDCW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPVOID]
    gdi32.CreateDCW.restype = wintypes.HDC
    gdi32.GetDeviceCaps.argtypes = [wintypes.HDC, ctypes.c_int]
    gdi32.GetDeviceCaps.restype = ctypes.c_int
    gdi32.StartDocW.argtypes = [wintypes.HDC, ctypes.POINTER(DOCINFOW)]
    gdi32.StartDocW.restype = ctypes.c_int
    gdi32.StartPage.argtypes = [wintypes.HDC]
    gdi32.StartPage.restype = ctypes.c_int
    gdi32.EndPage.argtypes = [wintypes.HDC]
    gdi32.EndPage.restype = ctypes.c_int
    gdi32.EndDoc.argtypes = [wintypes.HDC]
    gdi32.EndDoc.restype = ctypes.c_int
    gdi32.AbortDoc.argtypes = [wintypes.HDC]
    gdi32.AbortDoc.restype = ctypes.c_int
    gdi32.DeleteDC.argtypes = [wintypes.HDC]
    gdi32.DeleteDC.restype = wintypes.BOOL
    hdc = gdi32.CreateDCW("WINSPOOL", printer_name, None, buffer)
    if not hdc:
        raise ctypes.WinError(ctypes.get_last_error())
    caps = {
        "physicalWidthPx": gdi32.GetDeviceCaps(hdc, PHYSICALWIDTH),
        "physicalHeightPx": gdi32.GetDeviceCaps(hdc, PHYSICALHEIGHT),
        "printableWidthPx": gdi32.GetDeviceCaps(hdc, HORZRES),
        "printableHeightPx": gdi32.GetDeviceCaps(hdc, VERTRES),
        "offsetXPx": gdi32.GetDeviceCaps(hdc, PHYSICALOFFSETX),
        "offsetYPx": gdi32.GetDeviceCaps(hdc, PHYSICALOFFSETY),
        "dpiX": gdi32.GetDeviceCaps(hdc, LOGPIXELSX),
        "dpiY": gdi32.GetDeviceCaps(hdc, LOGPIXELSY),
    }
    caps["physicalWidthMm"] = round(caps["physicalWidthPx"] * 25.4 / caps["dpiX"], 2)
    caps["physicalHeightMm"] = round(caps["physicalHeightPx"] * 25.4 / caps["dpiY"], 2)
    return gdi32, hdc, caps


def render_pdf(pdf_path: Path, pdftoppm: str, dpi: int, output_dir: Path):
    prefix = output_dir / "label"
    subprocess.run(
        [pdftoppm, "-png", "-r", str(dpi), "-cropbox", str(pdf_path), str(prefix)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    pages = sorted(output_dir.glob("label-*.png"))
    if not pages:
        raise RuntimeError("Poppler did not render any label pages.")
    return pages


def print_images(gdi32, hdc, image_paths, caps, document_name):
    document = DOCINFOW(ctypes.sizeof(DOCINFOW), document_name, None, None, 0)
    job_id = gdi32.StartDocW(hdc, ctypes.byref(document))
    if job_id <= 0:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        for image_path in image_paths:
            if gdi32.StartPage(hdc) <= 0:
                raise ctypes.WinError(ctypes.get_last_error())
            try:
                with Image.open(image_path) as source:
                    image = source.convert("RGB")
                    dib = ImageWin.Dib(image)
                    left = -caps["offsetXPx"]
                    top = -caps["offsetYPx"]
                    right = caps["physicalWidthPx"] - caps["offsetXPx"]
                    bottom = caps["physicalHeightPx"] - caps["offsetYPx"]
                    dib.draw(int(hdc), (left, top, right, bottom))
            finally:
                if gdi32.EndPage(hdc) <= 0:
                    raise ctypes.WinError(ctypes.get_last_error())
        if gdi32.EndDoc(hdc) <= 0:
            raise ctypes.WinError(ctypes.get_last_error())
    except Exception:
        gdi32.AbortDoc(hdc)
        raise
    return job_id


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--printer", required=True)
    parser.add_argument("--form", required=True)
    parser.add_argument("--expected-pages", type=int, required=True)
    parser.add_argument("--render-dpi", type=int, default=203)
    parser.add_argument("--pdftoppm", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()

    if sys.platform != "win32":
        raise RuntimeError("Windows is required for direct PDF printing.")
    pdf_path = Path(args.pdf).resolve()
    if not pdf_path.is_file():
        raise FileNotFoundError(pdf_path)
    metadata = pdf_metadata(pdf_path)
    if metadata["pageCount"] != args.expected_pages:
        raise RuntimeError(
            f"PDF page count {metadata['pageCount']} does not match expected {args.expected_pages}."
        )
    assert_label_page_sizes(metadata["pageSizesMm"])

    winspool, handle, forms = open_printer_and_forms(args.printer)
    papers = device_capability_papers(winspool, args.printer)
    paper = next((item for item in papers if item["name"] == args.form), None)
    form = next((item for item in forms if item["name"] == args.form), None)
    if paper:
        form = {**paper, "source": "device-capability"}
    elif form:
        form["source"] = "printer-form"
    else:
        form = {"name": args.form, "widthMm": 109, "heightMm": 127, "source": "custom-size"}
    if abs(form["widthMm"] - 109) > 0.5 or abs(form["heightMm"] - 127) > 0.5:
        winspool.ClosePrinter(handle)
        raise RuntimeError(f"Unexpected printer form size: {form}")

    gdi32 = None
    hdc = None
    try:
        gdi32, hdc, caps = create_printer_dc(
            winspool,
            handle,
            args.printer,
            paper,
            form["widthMm"],
            form["heightMm"],
        )
        if abs(caps["physicalWidthMm"] - 109) > 2 or abs(caps["physicalHeightMm"] - 127) > 2:
            nearby = [
                item for item in papers
                if abs(item["widthMm"] - 109) <= 15 or abs(item["heightMm"] - 127) <= 15
            ]
            raise RuntimeError(
                "Printer rejected the 109x127 mm page size: "
                f"caps={caps}; source={form['source']}; candidates={json.dumps(nearby, ensure_ascii=True)}"
            )
        job_id = None
        if args.execute:
            with tempfile.TemporaryDirectory(prefix="commerce-os-labels-") as temp_dir:
                images = render_pdf(pdf_path, args.pdftoppm, args.render_dpi, Path(temp_dir))
                if len(images) != args.expected_pages:
                    raise RuntimeError(
                        f"Rendered page count {len(images)} does not match expected {args.expected_pages}."
                    )
                job_id = print_images(gdi32, hdc, images, caps, "Shopling courier labels")
        print(json.dumps({
            "executed": args.execute,
            "printer": args.printer,
            "form": form,
            "pageCount": metadata["pageCount"],
            "pageSizesMm": metadata["pageSizesMm"],
            "renderDpi": args.render_dpi,
            "printerCaps": caps,
            "jobId": job_id,
        }, ensure_ascii=False))
    finally:
        if hdc and gdi32:
            gdi32.DeleteDC(hdc)
        winspool.ClosePrinter(handle)


if __name__ == "__main__":
    main()
