#!/usr/bin/env python3
"""Validate a Navora gathering-resource family manifest and its starting budgets."""

from __future__ import annotations

import json
import pathlib
import sys


BUDGETS = {
    "woodcutting": ((8000, 14000), (2500, 5000), (400, 1200), 2048),
    "mining": ((2500, 6000), (700, 1800), (120, 400), 2048),
    "foraging": ((2000, 5000), (600, 1500), (150, 400), 1024),
}


def fail(message: str, errors: list[str]) -> None:
    errors.append(message)


def validate(path: pathlib.Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    errors: list[str] = []
    for key in ("schemaVersion", "familyId", "displayName", "status", "profession", "sourceAuthority", "variants", "collision", "textureSet"):
        if key not in data:
            fail(f"missing required field: {key}", errors)
    if errors:
        return errors
    if data["status"] not in {"canon", "working", "provisional"}:
        fail("status must be canon, working, or provisional", errors)
    budget = BUDGETS.get(data["profession"])
    if not budget:
        fail("profession must be mining, woodcutting, or foraging", errors)
        return errors
    if not isinstance(data["variants"], list) or len(data["variants"]) != 3:
        fail("exactly three authored variants are required", errors)
    else:
        seen: set[str] = set()
        for variant in data["variants"]:
            variant_id = variant.get("id")
            if not variant_id or variant_id in seen:
                fail("variant ids must be present and unique", errors)
            seen.add(variant_id)
            triangles = variant.get("lodTriangles")
            files = variant.get("runtimeFiles")
            if not isinstance(triangles, list) or len(triangles) != 3 or not all(isinstance(value, int) and value > 0 for value in triangles):
                fail(f"{variant_id}: lodTriangles must contain three positive integers", errors)
                continue
            if not triangles[0] > triangles[1] > triangles[2]:
                fail(f"{variant_id}: LOD triangle counts must decrease strictly", errors)
            for lod, (count, limits) in enumerate(zip(triangles, budget[:3])):
                if not limits[0] <= count <= limits[1]:
                    fail(f"{variant_id}: LOD{lod} triangles {count} outside {limits[0]}-{limits[1]}", errors)
            if not isinstance(files, list) or len(files) != 3:
                fail(f"{variant_id}: exactly three runtimeFiles are required", errors)
    if data.get("materials", 0) < 1 or data.get("materials", 0) > 2:
        fail("materials must be between 1 and 2", errors)
    textures = data["textureSet"]
    if textures.get("runtimeFormat") != "KTX2":
        fail("textureSet.runtimeFormat must be KTX2", errors)
    if textures.get("maxResolution", 0) > budget[3]:
        fail(f"texture resolution exceeds {budget[3]} for {data['profession']}", errors)
    if data["collision"].get("type") not in {"capsule", "convex-hull", "compound"}:
        fail("collision.type must be capsule, convex-hull, or compound", errors)
    for source in data.get("provenance", []):
        for key in ("url", "license", "sha256"):
            if not source.get(key):
                fail(f"provenance entry missing {key}", errors)
    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_resource_family.py <manifest.json>", file=sys.stderr)
        return 2
    path = pathlib.Path(sys.argv[1])
    try:
        errors = validate(path)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print(f"OK: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
