const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
] as const;

const START_CODE_B = 104;
const STOP_CODE = 106;
const QUIET_ZONE_MODULES = 10;

export interface Code128Bar {
  x: number;
  width: number;
}

export interface Code128Layout {
  bars: Code128Bar[];
  width: number;
}

export function encodeCode128B(value: string): number[] {
  if (!value || [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint > 126;
  })) {
    throw new Error("CODE128-B는 ASCII 32~126 문자만 지원합니다.");
  }

  const dataCodes = [...value].map((character) => character.charCodeAt(0) - 32);
  const checksum = dataCodes.reduce(
    (sum, code, index) => sum + code * (index + 1),
    START_CODE_B,
  ) % 103;

  return [START_CODE_B, ...dataCodes, checksum, STOP_CODE];
}

export function createCode128Layout(value: string): Code128Layout {
  const codes = encodeCode128B(value);
  const bars: Code128Bar[] = [];
  let x = QUIET_ZONE_MODULES;

  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code];

    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index]);
      if (index % 2 === 0) {
        bars.push({ x, width });
      }
      x += width;
    }
  }

  return { bars, width: x + QUIET_ZONE_MODULES };
}
