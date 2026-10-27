#!/usr/bin/env python3
"""WCA 公式の結果エクスポート（TSV・v2形式）から「ランキングの推移」用のデータを作ります。

使い方:
    python tools/build_rank_history.py --out _build            # WCAから最新のエクスポートを取得して作成
    python tools/build_rank_history.py --zip export.zip --out _build   # 手元のzipから作成

出力（<out>/rankhist/）:
    meta.json              国・大陸・種目ごとのファイル一覧
    persons.bin.gz         選手ごとの国（uint16、選手番号の順）
    <種目>-single.bin.gz   単発の自己ベスト更新の履歴
    <種目>-average.bin.gz  平均の自己ベスト更新の履歴

種目ファイルの形式（gzip を展開した中身）:
    "WRH1" + varint(月数) + 月ごとの件数 varint × 月数
    + 各月の記録（選手番号の昇順）: varint(前の選手番号との差) + varint(記録)
    月は 1982年1月 を 0 とした通し番号（大会の開始日の月）。
    記録は WCA の値そのまま（小さいほど良い。複数目隠しも数値の大小で比べられる形式）。

外部ライブラリは使いません（Python 3.9 以上の標準ライブラリのみ）。
"""
import argparse
import array
import gzip
import io
import json
import os
import sys
import time
import urllib.request
import zipfile

EXPORT_API = "https://www.worldcubeassociation.org/api/v0/export/public"
BASE_YEAR = 1982
UA = {"User-Agent": "wca-stats-site rank-history builder (+https://github.com/)"}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def download_export(dest):
    req = urllib.request.Request(EXPORT_API, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        info = json.load(r)
    url = info["tsv_url"]
    log("export", info.get("export_date"), url)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=900) as r, open(dest, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    log("downloaded", os.path.getsize(dest), "bytes")
    return info.get("export_date")


def tsv_rows(z, table):
    """エクスポートの WCA_export_<table>.tsv を1行ずつ (ヘッダー, 列のリスト) で返す。"""
    name = next(n for n in z.namelist() if n.endswith(f"WCA_export_{table}.tsv"))
    with z.open(name) as f:
        t = io.TextIOWrapper(f, encoding="utf-8", newline="")
        header = t.readline().rstrip("\r\n").split("\t")
        yield header
        for line in t:
            yield line.rstrip("\r\n").split("\t")


def table(z, name, cols):
    rows = tsv_rows(z, name)
    header = next(rows)
    idx = [header.index(c) for c in cols]
    for r in rows:
        if len(r) < len(header):
            continue
        yield [r[i] for i in idx]


def varint(out, n):
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", help="手元の WCA_export TSV zip（省略時はWCAから取得）")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    out_dir = os.path.join(args.out, "rankhist")
    os.makedirs(out_dir, exist_ok=True)
    export_date = None
    zpath = args.zip
    if not zpath:
        zpath = os.path.join(args.out, "WCA_export.tsv.zip")
        export_date = download_export(zpath)

    with zipfile.ZipFile(zpath) as z:
        if not export_date:
            meta_name = next((n for n in z.namelist() if n.endswith("metadata.json")), None)
            if meta_name:
                try:
                    export_date = json.loads(z.read(meta_name)).get("export_date")
                except Exception:
                    pass

        # 大陸・国
        continents = {cid: {"name": name, "record": rec} for cid, name, rec in table(z, "continents", ["id", "name", "record_name"])}
        countries = []          # [{id, iso2, cont}]
        country_idx = {}
        for cid, iso2, cont in table(z, "countries", ["id", "iso2", "continent_id"]):
            country_idx[cid] = len(countries)
            countries.append({"id": cid, "iso2": iso2, "cont": cont})
        log("countries", len(countries))

        # 大会の開始月
        comp_month = {}
        for cid, y, m in table(z, "competitions", ["id", "year", "month"]):
            try:
                comp_month[cid] = (int(y) - BASE_YEAR) * 12 + (int(m) - 1)
            except ValueError:
                pass
        log("competitions", len(comp_month))

        # 選手（現在の国 = sub_id 1）
        person_country = {}
        for wid, sub, ctry in table(z, "persons", ["wca_id", "sub_id", "country_id"]):
            if sub == "1" or wid not in person_country:
                person_country[wid] = ctry
        pids = sorted(person_country)
        pidx = {p: i for i, p in enumerate(pids)}
        log("persons", len(pids))

        # 結果を種目ごとにまとめる（選手番号・月・単発・平均）
        per_event = {}
        n = 0
        for comp, ev, pid, best, avg in table(z, "results", ["competition_id", "event_id", "person_id", "best", "average"]):
            m = comp_month.get(comp)
            p = pidx.get(pid)
            if m is None or p is None:
                continue
            b, a = int(best), int(avg)
            if b <= 0 and a <= 0:
                continue
            arrs = per_event.get(ev)
            if arrs is None:
                arrs = per_event[ev] = (array.array("i"), array.array("i"), array.array("q"), array.array("q"))
            arrs[0].append(p); arrs[1].append(m); arrs[2].append(b); arrs[3].append(a)
            n += 1
        log("results", n, "events", len(per_event))

    n_months = max(comp_month.values()) + 1
    files = {}
    for ev in sorted(per_event):
        P, M, B, A = per_event[ev]
        files[ev] = {}
        for typ, V in (("single", B), ("average", A)):
            rows = sorted((P[i], M[i], V[i]) for i in range(len(P)) if V[i] > 0)
            if not rows:
                continue
            # 自己ベストを更新した月だけを残す
            imp = []
            cur, best = -1, None
            for p, m, v in rows:
                if p != cur:
                    cur, best = p, None
                if best is None or v < best:
                    if imp and imp[-1][1] == p and imp[-1][0] == m:
                        imp[-1] = (m, p, v)
                    else:
                        imp.append((m, p, v))
                    best = v
            imp.sort()
            counts = [0] * n_months
            for m, _, _ in imp:
                counts[m] += 1
            buf = bytearray(b"WRH1")
            varint(buf, n_months)
            for c in counts:
                varint(buf, c)
            last_m, last_p = -1, 0
            for m, p, v in imp:
                if m != last_m:
                    last_m, last_p = m, 0
                varint(buf, p - last_p)
                varint(buf, v)
                last_p = p
            name = f"{ev}-{typ}.bin.gz"
            data = gzip.compress(bytes(buf), compresslevel=9, mtime=0)
            with open(os.path.join(out_dir, name), "wb") as f:
                f.write(data)
            files[ev][typ] = {"file": name, "records": len(imp), "persons": len({p for _, p, _ in imp}), "bytes": len(data)}
            log(ev, typ, "records", len(imp), "gz", len(data))
        if not files[ev]:
            del files[ev]

    pc = array.array("H", (country_idx.get(person_country[p], 0xFFFF) for p in pids))
    if sys.byteorder != "little":
        pc.byteswap()
    with open(os.path.join(out_dir, "persons.bin.gz"), "wb") as f:
        f.write(gzip.compress(pc.tobytes(), compresslevel=9, mtime=0))

    meta = {
        "version": 1,
        "exportDate": export_date,
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "baseYear": BASE_YEAR,
        "months": n_months,
        "persons": len(pids),
        "countries": countries,
        "continents": continents,
        "files": files,
    }
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
    log("done", out_dir)


if __name__ == "__main__":
    main()
