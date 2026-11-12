import { NextRequest, NextResponse } from "next/server";
import {
  installDomeggookTasks,
  readDomeggookAccountsSettings,
  readDomeggookLocalState,
  runAllDomeggookAccountsNow,
  runDomeggookAccountNow,
  saveDomeggookCredentials,
  writeDomeggookAccountsSettings,
  type DomeggookAccountsSettings,
} from "@/lib/domeggookPeriodExtensionLocal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertLocalRequest(request: NextRequest) {
  const hostname = request.nextUrl.hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error("로컬 Windows에서 연 Commerce OS에서만 이 기능을 실행할 수 있습니다.");
  }
  const origin = request.headers.get("origin");
  if (origin && !["localhost", "127.0.0.1", "::1"].includes(new URL(origin).hostname.toLowerCase())) {
    throw new Error("다른 사이트에서 보낸 실행 요청은 차단됩니다.");
  }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "요청 처리 중 오류가 발생했습니다.";
  return NextResponse.json({ ok: false, message }, { status: 400 });
}

export async function GET(request: NextRequest) {
  try {
    assertLocalRequest(request);
    return NextResponse.json({ ok: true, ...(await readDomeggookLocalState()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertLocalRequest(request);
    const body = await request.json() as {
      action?: string;
      accountId?: string;
      settings?: Partial<DomeggookAccountsSettings>;
      passwords?: Record<string, string>;
    };
    const action = String(body.action || "");
    let bulkRun = null;
    let settings = body.settings
      ? await writeDomeggookAccountsSettings(body.settings)
      : await readDomeggookAccountsSettings();
    await saveDomeggookCredentials(body.passwords);
    if (action === "save") {
      // Writing the normalized settings above is the complete save action.
    } else if (action === "install") {
      settings = await installDomeggookTasks(settings);
    } else if (["open-browser", "dry-run", "execute-now"].includes(action)) {
      const account = settings.accounts.find((candidate) => candidate.accountId === body.accountId);
      if (!account) throw new Error("선택한 도매꾹 계정 설정을 찾지 못했습니다.");
      await runDomeggookAccountNow(account, action === "execute-now", action === "open-browser");
    } else if (action === "execute-all-now") {
      if (!settings.accounts.length) throw new Error("즉시 실행할 도매꾹 계정이 없습니다.");
      bulkRun = await runAllDomeggookAccountsNow(settings.accounts);
    } else {
      throw new Error("지원하지 않는 작업입니다.");
    }
    return NextResponse.json({ ok: true, bulkRun, ...(await readDomeggookLocalState()) });
  } catch (error) {
    return errorResponse(error);
  }
}
