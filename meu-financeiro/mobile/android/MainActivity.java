package br.com.meufinanceiro.offline;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String HOST = "app.meufinanceiro.local";
    private static final String HOME = "https://" + HOST + "/index.html";
    private static final int IMPORT = 10;
    private static final int EXPORT = 11;
    private static final int MAX_BACKUP_CHARS = 10000000;
    private static final String COLOR = "#0d1422";

    private WebView web;
    private ValueCallback<Uri[]> importCallback;
    private String pendingExport;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.parseColor(COLOR));
        getWindow().setNavigationBarColor(Color.parseColor(COLOR));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor(COLOR));
        web.setLayoutParams(new ViewGroup.LayoutParams(-1, -1));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isAppPage(request.getUrl());
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isAppPage(Uri.parse(url));
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request.getUrl());
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return serve(Uri.parse(url));
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (importCallback != null) importCallback.onReceiveValue(null);
                importCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.setType("*/*");
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                try {
                    startActivityForResult(intent, IMPORT);
                } catch (ActivityNotFoundException error) {
                    importCallback.onReceiveValue(null);
                    importCallback = null;
                    Toast.makeText(MainActivity.this, "Não foi possível abrir o seletor de arquivos.", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
        web.addJavascriptInterface(new BackupBridge(), "AndroidFinance");
        setContentView(web);
        web.loadUrl(HOME);
    }

    private static boolean isAppOrigin(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == -1;
    }

    private static boolean isAppPage(Uri uri) {
        return isAppOrigin(uri) && ("/".equals(uri.getPath()) || "/index.html".equals(uri.getPath()));
    }

    private WebResourceResponse serve(Uri uri) {
        if (!isAppOrigin(uri)) return error(403, "Forbidden");
        String path = uri.getPath();
        if ("/".equals(path)) path = "/index.html";
        if (path == null || !path.matches("/[a-zA-Z0-9][a-zA-Z0-9.-]*")) return error(404, "Not Found");
        String name = path.substring(1);
        String mime = mimeType(name);
        if (mime == null) return error(404, "Not Found");
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            + "img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; "
            + "frame-src 'none'; frame-ancestors 'none'; form-action 'none'; worker-src 'none'");
        try {
            String encoding = mime.equals("image/png") ? null : "UTF-8";
            return new WebResourceResponse(mime, encoding, 200, "OK", headers,
                getAssets().open("web/" + name));
        } catch (IOException error) {
            return error(404, "Not Found");
        }
    }

    private static String mimeType(String name) {
        if (name.endsWith(".html")) return "text/html";
        if (name.endsWith(".js")) return "text/javascript";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".webmanifest")) return "application/manifest+json";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".png")) return "image/png";
        return null;
    }

    private static WebResourceResponse error(int code, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", code, reason,
            new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    public final class BackupBridge {
        @JavascriptInterface public void saveBackup(String name, String json) {
            runOnUiThread(() -> {
                if (pendingExport != null) return;
                if (json == null || json.length() > MAX_BACKUP_CHARS || name == null
                    || !name.matches("meu-financeiro-backup-[0-9]{4}-[0-9]{2}-[0-9]{2}\\.json")) {
                    sendExportResult("error");
                    return;
                }
                pendingExport = json;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, name);
                try {
                    startActivityForResult(intent, EXPORT);
                } catch (ActivityNotFoundException error) {
                    pendingExport = null;
                    sendExportResult("error");
                }
            });
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        if (request == IMPORT && importCallback != null) {
            ValueCallback<Uri[]> callback = importCallback;
            importCallback = null;
            callback.onReceiveValue(uri != null ? new Uri[]{uri} : null);
        } else if (request == EXPORT) {
            String payload = pendingExport;
            pendingExport = null;
            if (uri == null) {
                sendExportResult("cancelled");
            } else if (payload == null) {
                sendExportResult("error");
            } else {
                new Thread(() -> {
                    String status;
                    try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                        if (output == null) throw new IOException("Output stream unavailable");
                        output.write(payload.getBytes(StandardCharsets.UTF_8));
                        status = "saved";
                    } catch (IOException | SecurityException error) {
                        status = "error";
                    }
                    final String outcome = status;
                    runOnUiThread(() -> sendExportResult(outcome));
                }, "financeiro-backup").start();
            }
        }
    }

    private void sendExportResult(String status) {
        if (web == null) return;
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-backup-result',{detail:{status:'"
            + status + "'}}));", null);
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (importCallback != null) importCallback.onReceiveValue(null);
        importCallback = null;
        if (web != null) {
            web.removeJavascriptInterface("AndroidFinance");
            ((ViewGroup) web.getParent()).removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
