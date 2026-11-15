// Image helpers for photos and the company logo (refactoring step 9).

/** Read an image file, scale it so its longer side is at most max px, and return it as a data URL. */
export async function resizeImage(file, max, type = 'image/jpeg') {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL(type, 0.82);
}

/** Width and height of an image given as a data URL. */
export async function imgDims(dataUrl) { return new Promise((res) => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res([4, 3]); im.src = dataUrl; }); }
