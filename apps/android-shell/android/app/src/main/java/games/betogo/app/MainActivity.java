package games.betogo.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.browser.customtabs.CustomTabsIntent;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

import java.util.HashSet;
import java.util.Set;

/**
 * 壳的全部定制都集中在这里，站点代码不做 App 特化（同一份 bundle 还要服务 H5/PWA/Telegram）。
 *
 * 三件事：
 *  1. 外部链接（支付网关、Google/Telegram 授权）走 Custom Tab，而不是覆盖 App 或跳系统浏览器
 *  2. 支持 window.open —— 充值就是靠它打开支付页
 *  3. 返回键映射到站内路由，根路由「再按一次退出」
 */
public class MainActivity extends BridgeActivity {

    /**
     * 站内域名的编译期种子。后台新配的线路域名不在这里，靠 sessionDomains 在运行时补齐 ——
     * 漏了会导致站内跳转被当成外链丢进 Custom Tab。
     */
    private static final String[] OWN_HOSTS = {
        "betogo.games", "betogo666.com", "betogo777.com", "betogo.ph",
        "betogo.xyz", "betogo.vip", "betogo888.com", "betogo.cc",
        "188facai.com", "betogo.app"
    };

    private long lastBackAt = 0;
    private boolean selectingDomain = false;
    private final Set<String> failedDomains = new HashSet<>();
    /** 本次选线中验签通过的域名，与 OWN_HOSTS 一起构成「站内」判据 */
    private final Set<String> sessionDomains = new HashSet<>();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自定义插件必须在 super.onCreate() 之前注册（Capacitor 桥在 super 里初始化）
        registerPlugin(HardwareIdPlugin.class);
        registerPlugin(SessionVaultPlugin.class);
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        // 不开多窗口，window.open(payUrl,'_blank') 会在当前 WebView 整页跳走并销毁原页面，
        // 订单轮询随之中断、用户支付完也回不来
        webView.getSettings().setSupportMultipleWindows(true);
        webView.setWebViewClient(new ExternalLinkWebViewClient(getBridge()));
        webView.setWebChromeClient(new PopupWebChromeClient(getBridge()));

        if (!loadAppLink(getIntent())) selectDomainAndLoad();
        registerBackHandler();
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadAppLink(intent);
    }

    /**
     * OAuth 在 Custom Tab 里完成后，Google 回跳我们自己的 /auth/xxx/callback，
     * 该路径已在 manifest 注册成 App Link，系统把它交回 App —— 登录态于是落在 App 的 WebView 里，
     * 而不是留在浏览器中（这正是壳里 Google 登录原本走不通的原因）。
     */
    private boolean loadAppLink(Intent intent) {
        if (intent == null || intent.getData() == null) return false;
        Uri url = intent.getData();
        if (!isOwnHost(url.getHost())) return false;
        getBridge().getWebView().loadUrl(url.toString());
        return true;
    }

    private void selectDomainAndLoad() {
        if (selectingDomain) return;
        selectingDomain = true;
        new AppDomainSelector(this).select(failedDomains, (origin, knownDomains) -> {
            selectingDomain = false;
            sessionDomains.addAll(knownDomains);
            if (origin == null) {
                getBridge().getWebView().evaluateJavascript(
                    "document.getElementById('t').textContent='Network unavailable';document.querySelector('.s').style.display='none'", null);
                showRetryDialog();
                return;
            }
            Uri target = Uri.parse(origin).buildUpon()
                .appendQueryParameter("market", BuildConfig.APP_MARKET)
                .appendQueryParameter("utm_source", "apk")
                .build();
            getBridge().getWebView().loadUrl(target.toString());
        });
    }

    /**
     * 线路全挂时唯一的出路。此前只把启动页文案改成 "please retry" 却没有任何可点的东西，
     * 用户只能杀进程重开 —— 而杀进程和点这里做的是同一件事，白白劝退。
     */
    private void showRetryDialog() {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
            .setTitle("Connection failed")
            .setMessage("Cannot reach the server. Check your network and try again.")
            .setCancelable(false)
            .setPositiveButton("Retry", (dialog, which) -> {
                // 整批失败通常是本机断网而非这些域名真挂了，重试时把上一轮的拉黑全部撤销
                failedDomains.clear();
                selectDomainAndLoad();
            })
            .show();
    }

    /** 把出问题的域名拉黑并立刻重选线路；候选被排完时 select 回调会给出 null 并提示用户。 */
    private void switchAwayFrom(String host) {
        if (!isOwnHost(host)) return;
        failedDomains.add(host.replaceFirst("^www\\.", ""));
        selectDomainAndLoad();
    }

    private void registerBackHandler() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge().getWebView();
                // SPA 在首页也会攒下一堆 pushState 历史，只看 canGoBack 会让用户按十几次才退得出去，
                // 所以首页一律走「再按一次退出」
                if (!isHomeUrl(webView.getUrl()) && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                long now = System.currentTimeMillis();
                if (now - lastBackAt < 2000) {
                    finish();
                    return;
                }
                lastBackAt = now;
                Toast.makeText(MainActivity.this, "Press back again to exit", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private static boolean isHomeUrl(String url) {
        if (url == null) return false;
        String path = Uri.parse(url).getPath();
        return path == null || path.equals("/") || path.equals("/home");
    }

    private boolean isOwnHost(String host) {
        if (host == null) return false;
        for (String own : OWN_HOSTS) {
            if (host.equals(own) || host.endsWith("." + own)) return true;
        }
        for (String own : sessionDomains) {
            if (host.equals(own) || host.endsWith("." + own)) return true;
        }
        return false;
    }

    /** Custom Tab：停留在 App 内、自带返回按钮、与系统浏览器共享登录态 */
    private void openInCustomTab(Uri url) {
        CustomTabsIntent tab = new CustomTabsIntent.Builder().setShowTitle(true).build();
        try {
            tab.launchUrl(this, url);
        } catch (Exception e) {
            // 设备没有支持 Custom Tabs 的浏览器时退回系统浏览器
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (Exception ignored) {}
        }
    }

    private class ExternalLinkWebViewClient extends BridgeWebViewClient {

        ExternalLinkWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // 只管顶层导航：游戏是跨域 iframe 加载的，放行否则整个游戏会被踢到浏览器
            if (!request.isForMainFrame()) return false;

            Uri url = request.getUrl();
            String scheme = url.getScheme();
            if (scheme == null || scheme.equals("data") || scheme.equals("blob")) return false;
            if (isOwnHost(url.getHost())) return false;
            // Telegram OIDC 留在 WebView：它的回跳是 JS 跳转，Custom Tab 里不触发 App Link
            // 交接，登录态会落在浏览器侧。TG 不像 Google 禁止 WebView OAuth，留下反而全通。
            // 页内"Open Telegram"的 tg:// 深链走下面 openInCustomTab 的 ACTION_VIEW 兜底拉起 TG App。
            if ("oauth.telegram.org".equals(url.getHost())) return false;

            openInCustomTab(url);
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (request.isForMainFrame()) switchAwayFrom(request.getUrl().getHost());
        }

        /**
         * 域名可达但回源挂了（502/503/504）走的是这里而不是 onReceivedError —— 这恰恰是最常见的
         * 故障形态。不接管的话用户会卡在错误页，明明还有备用线路也切不过去。
         * 4xx 不换线：那是页面级问题（登录过期、路由不存在），换域名解决不了还会白丢会话。
         */
        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            super.onReceivedHttpError(view, request, errorResponse);
            if (request.isForMainFrame() && errorResponse.getStatusCode() >= 500) {
                switchAwayFrom(request.getUrl().getHost());
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            String host = Uri.parse(url).getHost();
            if (host != null && isOwnHost(host)) failedDomains.clear();
        }
    }

    private class PopupWebChromeClient extends BridgeWebChromeClient {

        PopupWebChromeClient(Bridge bridge) {
            super(bridge);
        }

        /**
         * window.open 走的是这里而不是 shouldOverrideUrlLoading。拿目标 URL 的唯一办法是
         * 挂一个临时 WebView 接住这次导航，读到 URL 后立刻销毁它、改用 Custom Tab 打开。
         */
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            final WebView sink = new WebView(view.getContext());
            sink.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                    Uri url = request.getUrl();
                    if (isOwnHost(url.getHost())) {
                        getBridge().getWebView().loadUrl(url.toString());
                    } else {
                        openInCustomTab(url);
                    }
                    v.destroy();
                    return true;
                }
            });
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(sink);
            resultMsg.sendToTarget();
            return true;
        }
    }
}
