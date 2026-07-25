package games.betogo.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.browser.customtabs.CustomTabsIntent;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

/**
 * 壳的全部定制都集中在这里，站点代码不做 App 特化（同一份 bundle 还要服务 H5/PWA/Telegram）。
 *
 * 三件事：
 *  1. 外部链接（支付网关、Google/Telegram 授权）走 Custom Tab，而不是覆盖 App 或跳系统浏览器
 *  2. 支持 window.open —— 充值就是靠它打开支付页
 *  3. 返回键映射到站内路由，根路由「再按一次退出」
 */
public class MainActivity extends BridgeActivity {

    /** 站内域名，留在 App 的 WebView 里；其余一律 Custom Tab。与 capacitor.config.ts 的 allowNavigation 对应。
     *  ⚠️ 生产包入口是 betogo.app——漏掉它会让 App Link 回调被 loadAppLink 丢弃、
     *  站内导航被踢进 Custom Tab（Google/TG 登录回不来的事故根因） */
    private static final String[] OWN_HOSTS = { "betogo.games", "188facai.com", "betogo.app" };

    private long lastBackAt = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        // 不开多窗口，window.open(payUrl,'_blank') 会在当前 WebView 整页跳走并销毁原页面，
        // 订单轮询随之中断、用户支付完也回不来
        webView.getSettings().setSupportMultipleWindows(true);
        webView.setWebViewClient(new ExternalLinkWebViewClient(getBridge()));
        webView.setWebChromeClient(new PopupWebChromeClient(getBridge()));

        loadAppLink(getIntent());
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
    private void loadAppLink(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri url = intent.getData();
        if (!isOwnHost(url.getHost())) return;
        getBridge().getWebView().loadUrl(url.toString());
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

    private static boolean isOwnHost(String host) {
        if (host == null) return false;
        for (String own : OWN_HOSTS) {
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
