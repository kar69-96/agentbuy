import QRCode from "qrcode";

export async function generateQR(address: string): Promise<string> {
  return QRCode.toDataURL(address, {
    type: "image/png",
    margin: 2,
    width: 256,
    errorCorrectionLevel: "M",
  });
}
