import { describe, expect, it } from "vitest";
import { cellsForBbox, subdivide, cellId } from "../src/grid.js";
import { extractPlaceCid, phoneFromDataItemId, parseRating, parseReviewCount } from "../src/maps-parse.js";
import { normalizeForMatch, scoreInstagramMatch } from "../src/name-match.js";
import { toWhatsapp } from "../src/stages/whatsapp.js";
import { registrableDomain } from "../src/util.js";

describe("grid", () => {
  it("covers a bbox with cells", () => {
    const cells = cellsForBbox([-23.582, -46.712, -23.556, -46.672], 1.2);
    expect(cells.length).toBeGreaterThan(4);
    for (const c of cells) {
      expect(c.lat).toBeGreaterThan(-23.582);
      expect(c.lat).toBeLessThan(-23.556);
      expect(c.lng).toBeGreaterThan(-46.712);
      expect(c.lng).toBeLessThan(-46.672);
    }
  });

  it("subdivides into 4 children", () => {
    const kids = subdivide({ lat: -23.56, lng: -46.68 }, 0, 1.2);
    expect(kids).toHaveLength(4);
    expect(new Set(kids.map((k) => cellId("d", "k", k, 1))).size).toBe(4);
  });
});

describe("maps-parse", () => {
  it("extracts the feature-id CID from a place href", () => {
    const href =
      "https://www.google.com/maps/place/Barbearia+X/data=!4m2!3m1!1s0x94ce5b1234abcd:0x9f8e7d6c5b4a3210!8m2";
    expect(extractPlaceCid(href)).toBe("0x94ce5b1234abcd:0x9f8e7d6c5b4a3210");
  });

  it("falls back to ludocid / slug", () => {
    expect(extractPlaceCid("https://maps.google.com/?ludocid=12345")).toBe("ludocid:12345");
    expect(extractPlaceCid("https://www.google.com/maps/place/Studio+Ink/")).toBe("slug:studio+ink");
    expect(extractPlaceCid(null)).toBeNull();
  });

  it("parses phone / rating / review count", () => {
    expect(phoneFromDataItemId("phone:tel:+55 11 91234-5678")).toBe("+55 11 91234-5678");
    expect(parseRating("4,8")).toBe(4.8);
    expect(parseReviewCount("1.234 avaliações")).toBe(1234);
  });
});

describe("registrableDomain", () => {
  it("handles com.br", () => {
    expect(registrableDomain("www.minhabarbearia.com.br")).toBe("minhabarbearia.com.br");
    expect(registrableDomain("shop.example.com")).toBe("example.com");
  });
});

describe("instagram name matching", () => {
  it("strips category / legal noise", () => {
    expect(normalizeForMatch("Barbearia do Zé LTDA")).toBe("ze");
  });

  it("accepts a clear handle match", () => {
    const r = scoreInstagramMatch({ businessName: "Barbearia Navalha de Ouro", handle: "navalhadeouro" });
    expect(r.accepted).toBe(true);
    expect(r.reason).toBe("name-match");
  });

  it("accepts when the profile bio carries the phone", () => {
    const r = scoreInstagramMatch({
      businessName: "Academia Corpo em Movimento",
      handle: "cia.fit.sp",
      profileBio: "Unidade Pinheiros — WhatsApp (11) 91234-5678",
      phoneDigits: "5511912345678",
    });
    expect(r.accepted).toBe(true);
    expect(r.reason).toBe("phone-in-profile");
  });

  it("rejects an unrelated profile", () => {
    const r = scoreInstagramMatch({
      businessName: "Tattoo Estúdio Preto e Branco",
      handle: "random.influencer",
      profileFullName: "Just Some Person",
    });
    expect(r.accepted).toBe(false);
  });
});

describe("whatsapp", () => {
  it("normalizes a BR mobile to E.164 + wa.me", () => {
    const r = toWhatsapp("(11) 91234-5678");
    expect(r.e164).toBe("+5511912345678");
    expect(r.link).toBe("https://wa.me/5511912345678");
    expect(r.isMobile).toBe(true);
  });

  it("returns nulls for junk", () => {
    expect(toWhatsapp("not a phone").e164).toBeNull();
    expect(toWhatsapp(null).link).toBeNull();
  });
});
