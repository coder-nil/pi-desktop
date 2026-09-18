"use client";

import { I18nProvider } from "@/hooks/useI18n";
import { MobileRemoteView } from "@/components/MobileRemoteView";

/**
 * 手机遥控页入口。
 *
 * 与桌面端共用同一个 Next 应用与鉴权（HTTP Basic），但只加载这一屏所需的组件，
 * 不引入 markdown 渲染器、文件树或终端。
 */
export default function MobileRemotePage() {
  return (
    <I18nProvider>
      <MobileRemoteView />
    </I18nProvider>
  );
}
