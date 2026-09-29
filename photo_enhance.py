#!/usr/bin/env python3
"""Recover and enhance a photo that was captured by photographing a phone screen.

Steps:
  1. Locate the photo on the phone screen (or use --corners) and flatten it
     with a perspective transform, removing the bezel, status bar and tilt.
  2. Reduce screen moire / sensor noise.
  3. Balance white, boost local contrast (CLAHE) and sharpen.
  4. Optionally upscale.

This script does NOT remove watermarks. For an unwatermarked original, get the
full-resolution download from the service that issued the photo.

Usage:
  python photo_enhance.py input.jpg output.jpg [--scale 2] [--corners x1,y1,x2,y2,x3,y3,x4,y4]
Requires: pip install opencv-python-headless numpy
"""
import argparse

import cv2
import numpy as np


def order_corners(pts):
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s, d = pts.sum(axis=1), np.diff(pts, axis=1).ravel()
    # top-left, top-right, bottom-right, bottom-left
    return np.array([pts[s.argmin()], pts[d.argmin()], pts[s.argmax()], pts[d.argmax()]], dtype=np.float32)


def find_photo_corners(img):
    """Find the largest bright, colourful quadrilateral (the photo on screen)."""
    h, w = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    # Photo content is brighter than the dark bezel/background.
    mask = (hsv[..., 2] > 60).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((15, 15), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.2 * h * w:
        return None
    rect = cv2.minAreaRect(c)
    return order_corners(cv2.boxPoints(rect))


def warp(img, corners, inset=6):
    tl, tr, br, bl = corners
    out_w = int(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    out_h = int(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    dst = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(corners, dst)
    flat = cv2.warpPerspective(img, m, (out_w, out_h), flags=cv2.INTER_CUBIC)
    return flat[inset:out_h - inset, inset:out_w - inset]  # trim edge bleed


def gray_world_white_balance(img, strength=0.6):
    f = img.astype(np.float32)
    means = f.reshape(-1, 3).mean(axis=0)
    gain = means.mean() / np.maximum(means, 1e-6)
    gain = 1 + strength * (gain - 1)
    return np.clip(f * gain, 0, 255).astype(np.uint8)


def enhance(img, scale=1.0):
    # Moire from the screen pixel grid is high-frequency; a light blur plus
    # non-local-means denoising removes most of it while keeping edges.
    img = cv2.GaussianBlur(img, (3, 3), 0)
    img = cv2.fastNlMeansDenoisingColored(img, None, h=5, hColor=5, templateWindowSize=7, searchWindowSize=21)
    img = gray_world_white_balance(img)

    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(l)
    img = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)

    if scale and scale != 1.0:
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_LANCZOS4)

    # Unsharp mask
    blur = cv2.GaussianBlur(img, (0, 0), 2.0)
    img = cv2.addWeighted(img, 1.5, blur, -0.5, 0)

    # Gentle saturation lift
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * 1.08, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input")
    p.add_argument("output")
    p.add_argument("--scale", type=float, default=1.0, help="upscale factor, e.g. 2")
    p.add_argument("--corners", help="manual photo corners: x1,y1,x2,y2,x3,y3,x4,y4 (any order)")
    p.add_argument("--no-crop", action="store_true", help="skip screen detection/perspective fix")
    args = p.parse_args()

    img = cv2.imread(args.input)
    if img is None:
        raise SystemExit(f"Cannot read {args.input}")

    if not args.no_crop:
        if args.corners:
            corners = order_corners([float(v) for v in args.corners.split(",")])
        else:
            corners = find_photo_corners(img)
            if corners is None:
                print("Could not detect the photo area; enhancing the full image. Use --corners to set it.")
        if corners is not None:
            print("Photo corners (TL, TR, BR, BL):", corners.astype(int).tolist())
            img = warp(img, corners)

    out = enhance(img, args.scale)
    cv2.imwrite(args.output, out, [cv2.IMWRITE_JPEG_QUALITY, 95])
    print(f"Saved {args.output} ({out.shape[1]}x{out.shape[0]})")


if __name__ == "__main__":
    main()
