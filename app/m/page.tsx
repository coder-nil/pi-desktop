import { headers } from "next/headers";
import { I18nProvider } from "@/hooks/useI18n";
import { MobileLanHandoff } from "@/components/MobileLanHandoff";
import { MobileRemoteView } from "@/components/MobileRemoteView";
import { desktopEgressIps, warmDesktopEgressIps } from "@/lib/desktop-public-ip";
import { resolveLanOrigin } from "@/lib/mobile-entry";
import { buildMobileUrl } from "@/lib/mobile-pair";
import { clientIpFromHeaders, resolveMobileRoute } from "@/lib/mobile-route";

export const dynamic = "force-dynamic";

/**
 * 手机遥控页入口。
 *
 * 与桌面端共用同一个 Next 应用与鉴权（HTTP Basic），但只加载这一屏所需的组件，
 * 不引入 markdown 渲染器、文件树或终端。
 *
 * 这个页面同时是**路由判定点**：二维码只放一个稳定入口（公网域名），手机在这台
 * 机器同一个网络里时自动切到局域网直连，不需要用户选。判定为什么必须在服务端、
 * 以及为什么用「返回跳转页」而不是 302，见 lib/mobile-route.ts 的注释。
 */
type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MobileRemotePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = firstValue(params.session);
  const cwd = firstValue(params.cwd);
  const alreadyLocal = firstValue(params.lan) === "1";

  const headerList = await headers();
  const clientIp = clientIpFromHeaders((name) => headerList.get(name));

  const lanOrigin = resolveLanOrigin();
  const target = {
    ...(session ? { session } : {}),
    ...(cwd ? { cwd } : {}),
  };
  const lanUrl = lanOrigin ? buildMobileUrl(lanOrigin, target) : null;

  // 有判定价值时才去查出口 IP（冷缓存最多等 1.2 秒，超时就先用旧值）。
  const desktopIps = clientIp && lanUrl && !alreadyLocal ? await desktopEgressIps() : [];
  // 顺手预热：等手机来扫时缓存已经是热的。
  warmDesktopEgressIps();

  const decision = resolveMobileRoute({ clientIp, desktopIps, lanUrl, alreadyLocal });

  if (decision.redirectTo) {
    // 「用外网继续」的相对地址：停在当前来源上，只额外带一个 lan=1 表示别再跳。
    const stay = new URLSearchParams();
    if (session) stay.set("session", session);
    if (cwd) stay.set("cwd", cwd);
    stay.set("lan", "1");
    return (
      <I18nProvider>
        <MobileLanHandoff target={decision.redirectTo} stayUrl={`/m?${stay.toString()}`} />
      </I18nProvider>
    );
  }

  return (
    <I18nProvider>
      <MobileRemoteView />
    </I18nProvider>
  );
}
