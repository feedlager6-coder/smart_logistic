#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <initguid.h>
#include <commctrl.h>
#include <winhttp.h>
#include <ole2.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <time.h>
#include <shlobj.h>
#include <olectl.h>

#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "shell32.lib")

#define IDI_ICON1 101

// Control IDs
#define IDC_TAB             1001
#define IDC_BTN_PAIR        1002
#define IDC_BTN_TEST_1C     1003
#define IDC_BTN_SYNC_NOW    1004
#define IDC_BTN_DISCONNECT  1005
#define IDC_BTN_CLEAR_LOGS  1006
#define IDC_EDT_SERVER      1007
#define IDC_EDT_CODE        1008
#define IDC_CMB_BASES       1009
#define IDC_EDT_CONNSTR     1010
#define IDC_EDT_USER        1011
#define IDC_EDT_PWD         1012
#define IDC_CMB_INTERVAL    1013
#define IDC_EDT_LOGS        1014
#define IDC_ST_STATUS       1015
#define IDC_ST_ORDERS       1016
#define IDC_ST_STATUSES     1017
#define IDC_ST_LASTSYNC     1018
#define IDC_BTN_REFRESH_BASES 1019

#define DEFAULT_SERVER_URL  L""

static const IID s_IID_NULL = { 0, 0, 0, { 0, 0, 0, 0, 0, 0, 0, 0 } };

// Global Configuration
typedef struct {
    wchar_t server_url[512];
    wchar_t api_token[256];
    wchar_t agent_id[128];
    wchar_t organization[256];
    wchar_t base_name[256];
    wchar_t connection_string[1024];
    wchar_t username[128];
    wchar_t password[128];
    int sync_interval_min;
    int orders_sent;
    int statuses_updated;
    wchar_t last_sync_time[64];
} AppConfig;

static AppConfig g_cfg;
static HWND g_hMainWnd = NULL;
static HWND g_hTab = NULL;
static HFONT g_hFont = NULL;
static HFONT g_hFontBold = NULL;
static HFONT g_hFontLarge = NULL;
static HFONT g_hFontMono = NULL;
static HBRUSH g_hBgBrush = NULL;
static HBRUSH g_hCardBrush = NULL;
static HBRUSH g_hHeaderBrush = NULL;

// Tab panels controls container
static HWND g_tabPanels[4];
static HWND g_hEdtServer, g_hEdtCode, g_hBtnPair, g_hPairStatus;
static HWND g_hCmbBases, g_hEdtConnStr, g_hEdtUser, g_hEdtPwd, g_hBtnTest1C, g_hOneCStatus;
static HWND g_hStOrders, g_hStStatuses, g_hStLastSync, g_hBtnSyncNow, g_hCmbInterval, g_hBtnDisconnect, g_hDashStatus;
static HWND g_hEdtLogs, g_hBtnClearLogs;

static HANDLE g_hSyncThread = NULL;
static BOOL g_bRunning = TRUE;
static CRITICAL_SECTION g_logCs;

// Helper: Get Config File Path in %LOCALAPPDATA%\SmartRouteAgent
void GetConfigPath(wchar_t *outPath, size_t maxLen) {
    wchar_t appData[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, appData))) {
        swprintf(outPath, maxLen, L"%s\\SmartRouteAgent", appData);
        CreateDirectoryW(outPath, NULL);
        swprintf(outPath, maxLen, L"%s\\SmartRouteAgent\\config.json", appData);
    } else {
        wcscpy(outPath, L"config.json");
    }
}

// Simple JSON extraction helper
void JsonExtractString(const char *json, const char *key, wchar_t *outVal, size_t maxLen) {
    char pattern[128];
    snprintf(pattern, sizeof(pattern), "\"%s\":", key);
    const char *pos = strstr(json, pattern);
    if (!pos) {
        snprintf(pattern, sizeof(pattern), "\"%s\" :", key);
        pos = strstr(json, pattern);
    }
    if (pos) {
        pos += strlen(pattern);
        while (*pos == ' ' || *pos == '\t' || *pos == '\r' || *pos == '\n') pos++;
        if (*pos == '\"') {
            pos++;
            const char *end = strchr(pos, '\"');
            if (end) {
                int len = (int)(end - pos);
                char temp[1024];
                if (len >= sizeof(temp)) len = sizeof(temp) - 1;
                strncpy(temp, pos, len);
                temp[len] = '\0';
                MultiByteToWideChar(CP_UTF8, 0, temp, -1, outVal, (int)maxLen);
                return;
            }
        }
    }
    outVal[0] = L'\0';
}

int JsonExtractInt(const char *json, const char *key, int defaultVal) {
    char pattern[128];
    snprintf(pattern, sizeof(pattern), "\"%s\":", key);
    const char *pos = strstr(json, pattern);
    if (!pos) {
        snprintf(pattern, sizeof(pattern), "\"%s\" :", key);
        pos = strstr(json, pattern);
    }
    if (pos) {
        pos += strlen(pattern);
        while (*pos == ' ' || *pos == '\t' || *pos == '\r' || *pos == '\n') pos++;
        return atoi(pos);
    }
    return defaultVal;
}

// Logger
void AddLog(const wchar_t *level, const wchar_t *msg) {
    EnterCriticalSection(&g_logCs);
    time_t rawtime;
    struct tm *timeinfo;
    wchar_t timeBuf[32];
    time(&rawtime);
    timeinfo = localtime(&rawtime);
    wcsftime(timeBuf, 32, L"%H:%M:%S", timeinfo);

    wchar_t line[2048];
    swprintf(line, 2048, L"[%s] [%s] %s\r\n", timeBuf, level, msg);

    if (g_hEdtLogs && IsWindow(g_hEdtLogs)) {
        int len = GetWindowTextLengthW(g_hEdtLogs);
        SendMessageW(g_hEdtLogs, EM_SETSEL, (WPARAM)len, (LPARAM)len);
        SendMessageW(g_hEdtLogs, EM_REPLACESEL, FALSE, (LPARAM)line);
    }
    LeaveCriticalSection(&g_logCs);
}

// Config Load & Save
void LoadConfig() {
    // Defaults
    wcscpy(g_cfg.server_url, DEFAULT_SERVER_URL);
    g_cfg.api_token[0] = L'\0';
    g_cfg.agent_id[0] = L'\0';
    wcscpy(g_cfg.organization, L"SmartRoute Logistics");
    g_cfg.base_name[0] = L'\0';
    g_cfg.connection_string[0] = L'\0';
    g_cfg.username[0] = L'\0';
    g_cfg.password[0] = L'\0';
    g_cfg.sync_interval_min = 5;
    g_cfg.orders_sent = 0;
    g_cfg.statuses_updated = 0;
    wcscpy(g_cfg.last_sync_time, L"—");

    wchar_t path[MAX_PATH];
    GetConfigPath(path, MAX_PATH);

    FILE *f = _wfopen(path, L"rb");
    if (!f) {
        f = _wfopen(L"config.json", L"rb");
    }
    if (f) {
        fseek(f, 0, SEEK_END);
        long sz = ftell(f);
        fseek(f, 0, SEEK_SET);
        if (sz > 0 && sz < 100000) {
            char *buf = (char *)malloc(sz + 1);
            if (buf) {
                fread(buf, 1, sz, f);
                buf[sz] = '\0';
                
                wchar_t temp[512];
                JsonExtractString(buf, "server_url", temp, 512);
                if (temp[0]) wcscpy(g_cfg.server_url, temp);
                // Do not keep the retired Google Run address from older packages.
                // The server URL must come from the current deployment or be
                // entered explicitly by the user.
                if (wcsstr(g_cfg.server_url, L".run.app") != NULL ||
                    wcsstr(g_cfg.server_url, L"ais-dev-") != NULL) {
                    g_cfg.server_url[0] = L'\0';
                }
                
                JsonExtractString(buf, "api_token", temp, 256);
                if (temp[0]) wcscpy(g_cfg.api_token, temp);

                JsonExtractString(buf, "agent_id", temp, 128);
                if (temp[0]) wcscpy(g_cfg.agent_id, temp);

                JsonExtractString(buf, "organization", temp, 256);
                if (temp[0]) wcscpy(g_cfg.organization, temp);

                JsonExtractString(buf, "base_name", temp, 256);
                if (temp[0]) wcscpy(g_cfg.base_name, temp);

                JsonExtractString(buf, "connection_string", temp, 1024);
                if (temp[0]) wcscpy(g_cfg.connection_string, temp);

                JsonExtractString(buf, "username", temp, 128);
                if (temp[0]) wcscpy(g_cfg.username, temp);

                g_cfg.orders_sent = JsonExtractInt(buf, "total_orders_sent", 0);
                g_cfg.statuses_updated = JsonExtractInt(buf, "total_statuses_received", 0);
                
                JsonExtractString(buf, "last_sync_time", temp, 64);
                if (temp[0]) wcscpy(g_cfg.last_sync_time, temp);

                free(buf);
            }
        }
        fclose(f);
    }
}

void SaveConfig() {
    wchar_t path[MAX_PATH];
    GetConfigPath(path, MAX_PATH);

    FILE *f = _wfopen(path, L"wb");
    if (!f) return;

    char server_utf8[1024] = {0};
    char token_utf8[512] = {0};
    char agent_utf8[256] = {0};
    char org_utf8[512] = {0};
    char base_utf8[512] = {0};
    char conn_utf8[2048] = {0};
    char user_utf8[256] = {0};
    char sync_utf8[128] = {0};

    WideCharToMultiByte(CP_UTF8, 0, g_cfg.server_url, -1, server_utf8, sizeof(server_utf8), NULL, NULL);
    WideCharToMultiByte(CP_UTF8, 0, g_cfg.api_token, -1, token_utf8, sizeof(token_utf8), NULL, NULL);
    WideCharToMultiByte(CP_UTF8, 0, g_cfg.agent_id, -1, agent_utf8, sizeof(agent_utf8), NULL, NULL);
    WideCharToMultiByte(CP_UTF8, 0, g_cfg.organization, -1, org_utf8, sizeof(org_utf8), NULL, NULL);
    WideCharToMultiByte(CP_UTF8, 0, g_cfg.base_name, -1, base_utf8, sizeof(base_utf8), NULL, NULL);
    WideCharToMultiByte(CP_UTF8, 0, g_cfg.connection_string, -1, conn_utf8, sizeof(conn_utf8), NULL, NULL);
    WideCharToMultiByte(CP_UTF8, 0, g_cfg.username, -1, user_utf8, sizeof(user_utf8), NULL, NULL);
    WideCharToMultiByte(CP_UTF8, 0, g_cfg.last_sync_time, -1, sync_utf8, sizeof(sync_utf8), NULL, NULL);

    fprintf(f, "{\n");
    fprintf(f, "  \"version\": \"3.2.0\",\n");
    fprintf(f, "  \"server_url\": \"%s\",\n", server_utf8);
    fprintf(f, "  \"api_token\": \"%s\",\n", token_utf8);
    fprintf(f, "  \"agent_id\": \"%s\",\n", agent_utf8);
    fprintf(f, "  \"organization\": \"%s\",\n", org_utf8);
    fprintf(f, "  \"onec\": {\n");
    fprintf(f, "    \"base_name\": \"%s\",\n", base_utf8);
    fprintf(f, "    \"connection_string\": \"%s\",\n", conn_utf8);
    fprintf(f, "    \"username\": \"%s\"\n", user_utf8);
    fprintf(f, "  },\n");
    fprintf(f, "  \"sync\": {\n");
    fprintf(f, "    \"interval_minutes\": %d\n", g_cfg.sync_interval_min);
    fprintf(f, "  },\n");
    fprintf(f, "  \"stats\": {\n");
    fprintf(f, "    \"total_orders_sent\": %d,\n", g_cfg.orders_sent);
    fprintf(f, "    \"total_statuses_received\": %d,\n", g_cfg.statuses_updated);
    fprintf(f, "    \"last_sync_time\": \"%s\"\n", sync_utf8);
    fprintf(f, "  }\n");
    fprintf(f, "}\n");
    fclose(f);
}

// HTTP Helper using WinHTTP + curl fallback
BOOL SendHttpRequest(const wchar_t *fullUrl, const char *method, const char *jsonBody, const wchar_t *token, char *outResp, size_t maxRespLen, int *outStatus) {
    if (outStatus) *outStatus = 0;
    if (outResp && maxRespLen > 0) outResp[0] = '\0';

    URL_COMPONENTS urlComp;
    memset(&urlComp, 0, sizeof(urlComp));
    urlComp.dwStructSize = sizeof(urlComp);
    wchar_t hostName[512] = {0};
    wchar_t urlPath[2048] = {0};
    urlComp.lpszHostName = hostName;
    urlComp.dwHostNameLength = 511;
    urlComp.lpszUrlPath = urlPath;
    urlComp.dwUrlPathLength = 2047;

    if (!WinHttpCrackUrl(fullUrl, 0, 0, &urlComp)) {
        return FALSE;
    }
    hostName[urlComp.dwHostNameLength] = L'\0';
    urlPath[urlComp.dwUrlPathLength] = L'\0';
    if (urlComp.dwUrlPathLength == 0) {
        wcscpy(urlPath, L"/");
    }

    INTERNET_PORT port = urlComp.nPort;
    if (port == 0) {
        port = (urlComp.nScheme == INTERNET_SCHEME_HTTPS) ? 443 : 80;
    }

    HINTERNET hSession = WinHttpOpen(L"SmartRoute-1C-Agent/3.2", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (hSession) {
        // Enable TLS 1.2 and TLS 1.3
        DWORD protocols = 0x00000800 | 0x00002000;
        WinHttpSetOption(hSession, WINHTTP_OPTION_SECURE_PROTOCOLS, &protocols, sizeof(protocols));

        // Timeouts
        WinHttpSetTimeouts(hSession, 10000, 15000, 25000, 25000);

        HINTERNET hConnect = WinHttpConnect(hSession, hostName, port, 0);
        if (hConnect) {
            DWORD flags = (urlComp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
            wchar_t wMethod[16];
            MultiByteToWideChar(CP_UTF8, 0, method, -1, wMethod, 16);

            HINTERNET hRequest = WinHttpOpenRequest(hConnect, wMethod, urlPath, NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
            if (hRequest) {
                // Follow redirects, but never downgrade an HTTPS request to HTTP.
                DWORD redirectPolicy = WINHTTP_OPTION_REDIRECT_POLICY_DISALLOW_HTTPS_TO_HTTP;
                WinHttpSetOption(hRequest, WINHTTP_OPTION_REDIRECT_POLICY, &redirectPolicy, sizeof(redirectPolicy));

                wchar_t headers[1024] = L"Content-Type: application/json; charset=utf-8\r\nAccept: application/json\r\n";
                if (token && token[0]) {
                    wchar_t authHdr[512];
                    swprintf(authHdr, 512, L"Authorization: Bearer %s\r\n", token);
                    wcscat(headers, authHdr);
                }

                DWORD bodyLen = jsonBody ? (DWORD)strlen(jsonBody) : 0;
                BOOL bResults = WinHttpSendRequest(hRequest, headers, (DWORD)-1L, (LPVOID)jsonBody, bodyLen, bodyLen, 0);

                if (bResults) {
                    bResults = WinHttpReceiveResponse(hRequest, NULL);
                }

                if (bResults) {
                    DWORD dwStatusCode = 0;
                    DWORD dwSize = sizeof(dwStatusCode);
                    WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &dwStatusCode, &dwSize, WINHTTP_NO_HEADER_INDEX);
                    if (outStatus) *outStatus = (int)dwStatusCode;

                    DWORD dwDownloaded = 0;
                    DWORD totalRead = 0;
                    if (outResp) {
                        outResp[0] = '\0';
                        do {
                            dwSize = 0;
                            if (!WinHttpQueryDataAvailable(hRequest, &dwSize)) break;
                            if (dwSize == 0) break;

                            if (totalRead + dwSize >= maxRespLen) dwSize = (DWORD)(maxRespLen - totalRead - 1);
                            if (WinHttpReadData(hRequest, (LPVOID)(outResp + totalRead), dwSize, &dwDownloaded)) {
                                totalRead += dwDownloaded;
                                outResp[totalRead] = '\0';
                            }
                        } while (dwSize > 0 && totalRead < maxRespLen - 1);
                    }
                }

                WinHttpCloseHandle(hRequest);
                WinHttpCloseHandle(hConnect);
                WinHttpCloseHandle(hSession);

                if (bResults) return TRUE;
            } else {
                WinHttpCloseHandle(hConnect);
            }
        }
        WinHttpCloseHandle(hSession);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Fallback: Windows built-in curl.exe
    // ──────────────────────────────────────────────────────────────────────────
    wchar_t tempPath[MAX_PATH];
    GetTempPathW(MAX_PATH, tempPath);
    wchar_t outTempFile[MAX_PATH];
    wchar_t inTempFile[MAX_PATH];
    DWORD pid = GetCurrentProcessId();
    swprintf(outTempFile, MAX_PATH, L"%ssr_resp_%u.tmp", tempPath, pid);
    swprintf(inTempFile, MAX_PATH, L"%ssr_req_%u.tmp", tempPath, pid);

    if (jsonBody && jsonBody[0]) {
        FILE *fin = _wfopen(inTempFile, L"wb");
        if (fin) {
            fwrite(jsonBody, 1, strlen(jsonBody), fin);
            fclose(fin);
        }
    }

    wchar_t curlCmd[4096];
    if (token && token[0]) {
        if (jsonBody && jsonBody[0]) {
            swprintf(curlCmd, 4096, L"curl.exe -s -w \"%%{http_code}\" -X %hs -H \"Content-Type: application/json\" -H \"Authorization: Bearer %s\" --data-binary \"@%s\" \"%s\" -o \"%s\"",
                method, token, inTempFile, fullUrl, outTempFile);
        } else {
            swprintf(curlCmd, 4096, L"curl.exe -s -w \"%%{http_code}\" -X %hs -H \"Accept: application/json\" -H \"Authorization: Bearer %s\" \"%s\" -o \"%s\"",
                method, token, fullUrl, outTempFile);
        }
    } else {
        if (jsonBody && jsonBody[0]) {
            swprintf(curlCmd, 4096, L"curl.exe -s -w \"%%{http_code}\" -X %hs -H \"Content-Type: application/json\" --data-binary \"@%s\" \"%s\" -o \"%s\"",
                method, inTempFile, fullUrl, outTempFile);
        } else {
            swprintf(curlCmd, 4096, L"curl.exe -s -w \"%%{http_code}\" -X %hs -H \"Accept: application/json\" \"%s\" -o \"%s\"",
                method, fullUrl, outTempFile);
        }
    }

    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    memset(&si, 0, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    HANDLE hPipeRead, hPipeWrite;
    SECURITY_ATTRIBUTES sa;
    sa.nLength = sizeof(SECURITY_ATTRIBUTES);
    sa.bInheritHandle = TRUE;
    sa.lpSecurityDescriptor = NULL;
    if (CreatePipe(&hPipeRead, &hPipeWrite, &sa, 0)) {
        SetHandleInformation(hPipeRead, HANDLE_FLAG_INHERIT, 0);
        si.dwFlags |= STARTF_USESTDHANDLES;
        si.hStdOutput = hPipeWrite;
        si.hStdError = hPipeWrite;

        if (CreateProcessW(NULL, curlCmd, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
            CloseHandle(hPipeWrite);
            WaitForSingleObject(pi.hProcess, 15000);
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);

            char statusCodeBuf[32] = {0};
            DWORD bytesRead = 0;
            ReadFile(hPipeRead, statusCodeBuf, sizeof(statusCodeBuf) - 1, &bytesRead, NULL);
            CloseHandle(hPipeRead);

            int curlStatus = atoi(statusCodeBuf);
            if (outStatus) *outStatus = curlStatus;

            FILE *fout = _wfopen(outTempFile, L"rb");
            if (fout) {
                size_t r = fread(outResp, 1, maxRespLen - 1, fout);
                outResp[r] = '\0';
                fclose(fout);
                _wremove(outTempFile);
            }
            _wremove(inTempFile);

            if (curlStatus > 0) return TRUE;
        } else {
            CloseHandle(hPipeWrite);
            CloseHandle(hPipeRead);
        }
    }
    _wremove(outTempFile);
    _wremove(inTempFile);

    return FALSE;
}

static wchar_t *TrimWideText(wchar_t *value) {
    wchar_t *start = value;
    while (*start == L' ' || *start == L'\t' || *start == L'\r' || *start == L'\n') {
        start++;
    }
    wchar_t *end = start + wcslen(start);
    while (end > start && (end[-1] == L' ' || end[-1] == L'\t' || end[-1] == L'\r' || end[-1] == L'\n')) {
        *--end = L'\0';
    }
    return start;
}

static BOOL ReadTextFileForBases(const wchar_t *path, wchar_t **outText) {
    *outText = NULL;
    FILE *f = _wfopen(path, L"rb");
    if (!f) return FALSE;

    if (fseek(f, 0, SEEK_END) != 0) {
        fclose(f);
        return FALSE;
    }
    long fileSize = ftell(f);
    if (fileSize <= 0 || fileSize > 4 * 1024 * 1024) {
        fclose(f);
        return FALSE;
    }
    rewind(f);

    unsigned char *bytes = (unsigned char *)malloc((size_t)fileSize);
    if (!bytes) {
        fclose(f);
        return FALSE;
    }
    size_t bytesRead = fread(bytes, 1, (size_t)fileSize, f);
    fclose(f);
    if (bytesRead != (size_t)fileSize) {
        free(bytes);
        return FALSE;
    }

    size_t offset = 0;
    BOOL isUtf16 = FALSE;
    BOOL isBigEndian = FALSE;
    if (bytesRead >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE) {
        offset = 2;
        isUtf16 = TRUE;
    } else if (bytesRead >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF) {
        offset = 2;
        isUtf16 = TRUE;
        isBigEndian = TRUE;
    } else if (bytesRead >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF) {
        offset = 3;
    }

    wchar_t *text = NULL;
    if (isUtf16) {
        size_t wcharCount = (bytesRead - offset) / 2;
        text = (wchar_t *)malloc((wcharCount + 1) * sizeof(wchar_t));
        if (text) {
            for (size_t i = 0; i < wcharCount; i++) {
                unsigned char first = bytes[offset + i * 2];
                unsigned char second = bytes[offset + i * 2 + 1];
                text[i] = isBigEndian
                    ? (wchar_t)(((unsigned int)first << 8) | second)
                    : (wchar_t)(((unsigned int)second << 8) | first);
            }
            text[wcharCount] = L'\0';
        }
    } else {
        int byteCount = (int)(bytesRead - offset);
        int wideCount = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, (LPCCH)(bytes + offset), byteCount, NULL, 0);
        UINT codePage = CP_UTF8;
        if (wideCount <= 0) {
            codePage = CP_ACP;
            wideCount = MultiByteToWideChar(codePage, 0, (LPCCH)(bytes + offset), byteCount, NULL, 0);
        }
        if (wideCount > 0) {
            text = (wchar_t *)malloc((wideCount + 1) * sizeof(wchar_t));
            if (text) {
                MultiByteToWideChar(codePage, 0, (LPCCH)(bytes + offset), byteCount, text, wideCount);
                text[wideCount] = L'\0';
            }
        }
    }

    free(bytes);
    *outText = text;
    return text != NULL;
}

static int AddBaseToCombo(HWND hCmb, const wchar_t *name, const wchar_t *connect, int *selectedIndex) {
    wchar_t itemText[1024];
    swprintf(itemText, 1024, L"%s (%s)", name, (wcsstr(connect, L"Srvr=") ? L"Сервер 1С" : L"Файловая"));
    int idx = (int)SendMessageW(hCmb, CB_ADDSTRING, 0, (LPARAM)itemText);
    if (idx != CB_ERR && selectedIndex && wcscmp(name, g_cfg.base_name) == 0) {
        *selectedIndex = idx;
    }
    return idx == CB_ERR ? 0 : 1;
}

static int ParseIBasesText(HWND hCmb, const wchar_t *text, int *selectedIndex) {
    int count = 0;
    wchar_t currentName[256] = {0};
    wchar_t currentConnect[512] = {0};
    const wchar_t *cursor = text;

    while (cursor && *cursor) {
        const wchar_t *lineEnd = wcschr(cursor, L'\n');
        size_t lineLength = lineEnd ? (size_t)(lineEnd - cursor) : wcslen(cursor);
        wchar_t line[1024];
        if (lineLength >= sizeof(line) / sizeof(line[0])) {
            lineLength = sizeof(line) / sizeof(line[0]) - 1;
        }
        wcsncpy(line, cursor, lineLength);
        line[lineLength] = L'\0';
        wchar_t *trimmed = TrimWideText(line);

        size_t trimmedLength = wcslen(trimmed);
        if (trimmedLength >= 2 && trimmed[0] == L'[' && trimmed[trimmedLength - 1] == L']') {
            if (currentName[0] && currentConnect[0]) {
                count += AddBaseToCombo(hCmb, currentName, currentConnect, selectedIndex);
            }
            size_t nameLength = trimmedLength - 2;
            if (nameLength >= sizeof(currentName) / sizeof(currentName[0])) {
                nameLength = sizeof(currentName) / sizeof(currentName[0]) - 1;
            }
            wcsncpy(currentName, trimmed + 1, nameLength);
            currentName[nameLength] = L'\0';
            currentConnect[0] = L'\0';
        } else if (_wcsnicmp(trimmed, L"Connect=", 8) == 0) {
            wcsncpy(currentConnect, TrimWideText(trimmed + 8), sizeof(currentConnect) / sizeof(currentConnect[0]) - 1);
            currentConnect[sizeof(currentConnect) / sizeof(currentConnect[0]) - 1] = L'\0';
        }

        cursor = lineEnd ? lineEnd + 1 : NULL;
    }

    if (currentName[0] && currentConnect[0]) {
        count += AddBaseToCombo(hCmb, currentName, currentConnect, selectedIndex);
    }
    return count;
}

// 1C Base Scanner: Reads all standard ibases.v8i locations, including UTF-16 files.
void Populate1CBases(HWND hCmb) {
    SendMessageW(hCmb, CB_RESETCONTENT, 0, 0);
    SendMessageW(hCmb, CB_ADDSTRING, 0, (LPARAM)L"— Выберите базу 1С из списка на этом ПК —");
    int selectedIndex = 0;
    int baseCount = 0;

    wchar_t paths[6][MAX_PATH];
    int pathCount = 0;
    wchar_t appData[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_APPDATA, NULL, 0, appData))) {
        swprintf(paths[pathCount++], MAX_PATH, L"%s\\1C\\1CEStart\\ibases.v8i", appData);
        swprintf(paths[pathCount++], MAX_PATH, L"%s\\1C\\1Cv82\\ibases.v8i", appData);
        swprintf(paths[pathCount++], MAX_PATH, L"%s\\1C\\1Cv8\\ibases.v8i", appData);
    }
    wchar_t localAppData[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, localAppData))) {
        swprintf(paths[pathCount++], MAX_PATH, L"%s\\1C\\1CEStart\\ibases.v8i", localAppData);
        swprintf(paths[pathCount++], MAX_PATH, L"%s\\1C\\1Cv8\\ibases.v8i", localAppData);
        swprintf(paths[pathCount++], MAX_PATH, L"%s\\1C\\1Cv82\\ibases.v8i", localAppData);
    }

    for (int p = 0; p < pathCount; p++) {
        wchar_t *text = NULL;
        if (ReadTextFileForBases(paths[p], &text)) {
            baseCount += ParseIBasesText(hCmb, text, &selectedIndex);
            free(text);
        }
    }

    if (baseCount == 0) {
        SendMessageW(hCmb, CB_SETITEMDATA, 0, (LPARAM)-1);
        SendMessageW(hCmb, CB_DELETESTRING, 0, 0);
        SendMessageW(hCmb, CB_INSERTSTRING, 0, (LPARAM)L"— Базы 1С не найдены автоматически —");
        selectedIndex = 0;
    }
    SendMessageW(hCmb, CB_SETCURSEL, selectedIndex, 0);
}

// Update UI Text & Metrics
void UpdateUIState() {
    BOOL isPaired = (g_cfg.api_token[0] != L'\0');

    SetWindowTextW(g_hEdtServer, g_cfg.server_url);
    SetWindowTextW(g_hEdtConnStr, g_cfg.connection_string);
    SetWindowTextW(g_hEdtUser, g_cfg.username);
    SetWindowTextW(g_hEdtPwd, g_cfg.password);

    wchar_t buf[128];
    swprintf(buf, 128, L"%d", g_cfg.orders_sent);
    SetWindowTextW(g_hStOrders, buf);

    swprintf(buf, 128, L"%d", g_cfg.statuses_updated);
    SetWindowTextW(g_hStStatuses, buf);

    SetWindowTextW(g_hStLastSync, g_cfg.last_sync_time);

    if (isPaired) {
        wchar_t statusMsg[512];
        swprintf(statusMsg, 512, L"🟢 Привязано к организации: %s (ID: %s)", g_cfg.organization, g_cfg.agent_id);
        SetWindowTextW(g_hPairStatus, statusMsg);
        SetWindowTextW(g_hDashStatus, L"🟢 Статус: Подключено. Автосинхронизация каждые 5 минут активна.");
    } else {
        SetWindowTextW(g_hPairStatus, L"🟡 Не привязано. Введите код из веб-кабинета SmartRoute и нажмите кнопку.");
        SetWindowTextW(g_hDashStatus, L"🟡 Статус: Требуется привязка (Шаг 1).");
    }
}

typedef struct {
    wchar_t server[512];
    wchar_t code[128];
} PairThreadParams;

DWORD WINAPI PairWorkerThread(LPVOID lpParam) {
    PairThreadParams *params = (PairThreadParams *)lpParam;
    if (!params) return 0;

    wchar_t server[512];
    wchar_t code[128];
    wcscpy(server, params->server);
    wcscpy(code, params->code);
    free(params);

    // 1. Trim whitespace from code
    int cLen = (int)wcslen(code);
    while (cLen > 0 && (code[cLen-1] == L' ' || code[cLen-1] == L'\t' || code[cLen-1] == L'\r' || code[cLen-1] == L'\n')) {
        code[--cLen] = L'\0';
    }
    wchar_t *pCode = code;
    while (*pCode == L' ' || *pCode == L'\t') pCode++;
    _wcsupr(pCode);

    // Check if user pasted full URL#CODE into code field
    wchar_t *pHash = wcschr(pCode, L'#');
    if (pHash) {
        *pHash = L'\0';
        wcscpy(server, pCode);
        pCode = pHash + 1;
    }

    // 2. Trim whitespace and normalize server URL
    int sLen = (int)wcslen(server);
    while (sLen > 0 && (server[sLen-1] == L' ' || server[sLen-1] == L'\t' || server[sLen-1] == L'\r' || server[sLen-1] == L'\n' || server[sLen-1] == L'/')) {
        server[--sLen] = L'\0';
    }
    wchar_t *pServer = server;
    while (*pServer == L' ' || *pServer == L'\t') pServer++;

    wchar_t cleanServer[512];
    if (wcsncmp(pServer, L"http://", 7) != 0 && wcsncmp(pServer, L"https://", 8) != 0) {
        swprintf(cleanServer, 512, L"https://%s", pServer);
    } else {
        wcscpy(cleanServer, pServer);
    }

    // Trim trailing slash again
    sLen = (int)wcslen(cleanServer);
    while (sLen > 0 && cleanServer[sLen-1] == L'/') {
        cleanServer[--sLen] = L'\0';
    }

    AddLog(L"INFO", L"Подключение к серверу SmartRoute...");

    char code_utf8[256], server_utf8[512];
    WideCharToMultiByte(CP_UTF8, 0, pCode, -1, code_utf8, sizeof(code_utf8), NULL, NULL);
    WideCharToMultiByte(CP_UTF8, 0, cleanServer, -1, server_utf8, sizeof(server_utf8), NULL, NULL);

    char jsonBody[1024];
    snprintf(jsonBody, sizeof(jsonBody),
        "{\"pairing_code\":\"%s\",\"agent_name\":\"SmartRoute 1C Windows Native\",\"agent_version\":\"3.2.0\",\"base_name\":\"1C Infobase\",\"v8_version\":\"8.3\"}",
        code_utf8);

    wchar_t fullUrl[1024];
    swprintf(fullUrl, 1024, L"%s/api/integrations/1c/agent/pair", cleanServer);

    char resp[4096] = {0};
    int status = 0;
    BOOL ok = SendHttpRequest(fullUrl, "POST", jsonBody, NULL, resp, sizeof(resp), &status);

    if (ok && status == 200) {
        wchar_t token[256] = {0};
        wchar_t agentId[128] = {0};
        wchar_t org[256] = {0};

        JsonExtractString(resp, "token", token, 256);
        JsonExtractString(resp, "agent_id", agentId, 128);
        JsonExtractString(resp, "organization", org, 256);

        if (token[0]) {
            wcscpy(g_cfg.server_url, cleanServer);
            wcscpy(g_cfg.api_token, token);
            wcscpy(g_cfg.agent_id, agentId);
            if (org[0]) wcscpy(g_cfg.organization, org);
            SaveConfig();

            AddLog(L"SUCCESS", L"Привязка к SmartRoute успешно завершена!");

            if (g_hMainWnd && IsWindow(g_hMainWnd)) {
                PostMessageW(g_hMainWnd, WM_USER + 100, 0, 0);
            }

            EnableWindow(g_hBtnPair, TRUE);
            SetWindowTextW(g_hBtnPair, L"🔗 Привязать к SmartRoute");

            MessageBoxW(g_hMainWnd,
                L"УСПЕШНО!\n\nАгент 1С успешно привязан к личному кабинету SmartRoute.\nТеперь перейдите на вкладку «Шаг 2: База 1С» для выбора информационной базы.",
                L"SmartRoute 1C Agent",
                MB_ICONINFORMATION);

            TabCtrl_SetCurSel(g_hTab, 1);
            ShowWindow(g_tabPanels[0], SW_HIDE);
            ShowWindow(g_tabPanels[1], SW_SHOW);
            return 0;
        }
    }

    // Handle error
    EnableWindow(g_hBtnPair, TRUE);
    SetWindowTextW(g_hBtnPair, L"🔗 Привязать к SmartRoute");

    wchar_t serverErrMsg[512] = {0};
    if (resp[0]) {
        JsonExtractString(resp, "error", serverErrMsg, 512);
        if (!serverErrMsg[0]) {
            JsonExtractString(resp, "detail", serverErrMsg, 512);
        }
    }

    wchar_t errBuf[1024];
    if (status == 0) {
        swprintf(errBuf, 1024,
            L"Не удалось соединиться с сервером:\n%s\n\nПроверьте:\n1. Правильность адреса сервера (скопируйте из веб-кабинета SmartRoute).\n2. Наличие интернет-соединения.",
            cleanServer);
        SetWindowTextW(g_hPairStatus, L"❌ Ошибка соединения. Проверьте адрес сервера и интернет.");
    } else if (serverErrMsg[0]) {
        swprintf(errBuf, 1024, L"Ошибка от сервера (HTTP %d):\n%s", status, serverErrMsg);
        SetWindowTextW(g_hPairStatus, serverErrMsg);
    } else {
        swprintf(errBuf, 1024,
            L"Сервер вернул неожиданный ответ (HTTP %d).\nПроверьте, что указан именно адрес опубликованного SmartRoute API, а не сайт или страницу-заглушку.",
            status);
        SetWindowTextW(g_hPairStatus, errBuf);
    }

    AddLog(L"ERROR", errBuf);
    MessageBoxW(g_hMainWnd, errBuf, L"Ошибка привязки", MB_ICONERROR);
    return 0;
}

// Action 1: Pair with SmartRoute
void ActionPair() {
    wchar_t server[512], code[128];
    GetWindowTextW(g_hEdtServer, server, 512);
    GetWindowTextW(g_hEdtCode, code, 128);

    wchar_t *pServer = server;
    while (*pServer == L' ' || *pServer == L'\t') pServer++;

    // Quick trim
    wchar_t *pCode = code;
    while (*pCode == L' ' || *pCode == L'\t') pCode++;

    if (pServer[0] == L'\0') {
        MessageBoxW(g_hMainWnd,
            L"Пожалуйста, укажите адрес опубликованного сервера SmartRoute.\n\n"
            L"Адрес должен начинаться с https:// и вести к вашему рабочему кабинету, "
            L"а не к странице сайта или dev-preview.",
            L"SmartRoute 1C Agent",
            MB_ICONWARNING);
        SetFocus(g_hEdtServer);
        return;
    }

    if (pCode[0] == L'\0') {
        MessageBoxW(g_hMainWnd,
            L"Пожалуйста, введите код привязки (например: SMARTROUTE-7824-9132).\n\nКод можно скопировать в веб-кабинете SmartRoute в разделе «Интеграции → 1С».",
            L"SmartRoute 1C Agent",
            MB_ICONWARNING);
        SetFocus(g_hEdtCode);
        return;
    }

    SetWindowTextW(g_hPairStatus, L"⏳ Отправка запроса привязки на сервер...");
    SetWindowTextW(g_hBtnPair, L"⏳ Подключение...");
    EnableWindow(g_hBtnPair, FALSE);

    PairThreadParams *params = (PairThreadParams *)malloc(sizeof(PairThreadParams));
    if (params) {
        wcscpy(params->server, pServer);
        wcscpy(params->code, pCode);
        HANDLE thread = CreateThread(NULL, 0, PairWorkerThread, params, 0, NULL);
        if (thread) {
            CloseHandle(thread);
        } else {
            free(params);
            SetWindowTextW(g_hPairStatus, L"❌ Не удалось запустить проверку соединения Windows.");
            SetWindowTextW(g_hBtnPair, L"🔗 Привязать к SmartRoute");
            EnableWindow(g_hBtnPair, TRUE);
            MessageBoxW(g_hMainWnd,
                L"Не удалось запустить поток привязки. Перезапустите приложение и повторите попытку.",
                L"SmartRoute 1C Agent",
                MB_ICONERROR);
        }
    } else {
        SetWindowTextW(g_hPairStatus, L"❌ Недостаточно памяти для запуска привязки.");
        SetWindowTextW(g_hBtnPair, L"🔗 Привязать к SmartRoute");
        EnableWindow(g_hBtnPair, TRUE);
        MessageBoxW(g_hMainWnd,
            L"Не удалось начать привязку: недостаточно памяти Windows.",
            L"SmartRoute 1C Agent",
            MB_ICONERROR);
    }
}

// Action 2: Test 1C Connection via OLE/COM
void ActionTest1C() {
    wchar_t connStr[1024], user[128], pwd[128];
    GetWindowTextW(g_hEdtConnStr, connStr, 1024);
    GetWindowTextW(g_hEdtUser, user, 128);
    GetWindowTextW(g_hEdtPwd, pwd, 128);

    if (connStr[0] == L'\0') {
        MessageBoxW(g_hMainWnd, L"Укажите строку подключения к 1С или выберите базу из списка!", L"SmartRoute 1C Agent", MB_ICONWARNING);
        return;
    }

    SetWindowTextW(g_hOneCStatus, L"⏳ Проверка соединения через 1С COMConnector...");
    AddLog(L"INFO", L"Тестирование подключения к 1С:Предприятие...");

    CoInitialize(NULL);
    CLSID clsid;
    HRESULT hr = CLSIDFromProgID(L"V83.COMConnector", &clsid);
    if (FAILED(hr)) {
        hr = CLSIDFromProgID(L"V82.COMConnector", &clsid);
    }

    if (SUCCEEDED(hr)) {
        IDispatch *pDisp = NULL;
        hr = CoCreateInstance(&clsid, NULL, CLSCTX_INPROC_SERVER | CLSCTX_LOCAL_SERVER, &IID_IDispatch, (void**)&pDisp);
        if (SUCCEEDED(hr) && pDisp) {
            wchar_t fullConn[2048];
            wcscpy(fullConn, connStr);
            if (user[0] && !wcsstr(fullConn, L"Usr=")) {
                swprintf(fullConn + wcslen(fullConn), 2048 - wcslen(fullConn), L"Usr=\"%s\";", user);
            }
            if (pwd[0] && !wcsstr(fullConn, L"Pwd=")) {
                swprintf(fullConn + wcslen(fullConn), 2048 - wcslen(fullConn), L"Pwd=\"%s\";", pwd);
            }

            DISPID dispidConnect;
            OLECHAR *methodName = L"Connect";
            hr = pDisp->lpVtbl->GetIDsOfNames(pDisp, &s_IID_NULL, &methodName, 1, LOCALE_USER_DEFAULT, &dispidConnect);
            if (SUCCEEDED(hr)) {
                VARIANTARG vArg;
                VariantInit(&vArg);
                vArg.vt = VT_BSTR;
                vArg.bstrVal = SysAllocString(fullConn);

                DISPPARAMS dp = { &vArg, NULL, 1, 0 };
                VARIANT vResult;
                VariantInit(&vResult);

                hr = pDisp->lpVtbl->Invoke(pDisp, dispidConnect, &s_IID_NULL, LOCALE_USER_DEFAULT, DISPATCH_METHOD, &dp, &vResult, NULL, NULL);
                SysFreeString(vArg.bstrVal);

                if (SUCCEEDED(hr) && vResult.vt == VT_DISPATCH && vResult.pdispVal) {
                    VariantClear(&vResult);
                    pDisp->lpVtbl->Release(pDisp);
                    CoUninitialize();

                    wcscpy(g_cfg.connection_string, connStr);
                    wcscpy(g_cfg.username, user);
                    wcscpy(g_cfg.password, pwd);
                    SaveConfig();
                    SetWindowTextW(g_hOneCStatus, L"✅ УСПЕШНО! Подключение к базе 1С установлено.");
                    AddLog(L"SUCCESS", L"Подключение к 1С:Предприятие 8.3 успешно подтверждено!");
                    MessageBoxW(g_hMainWnd, L"Соединение с базой 1С успешно проверено и сохранено!\nПерейдите к Шагу 3 для запуска синхронизации.", L"SmartRoute 1C Agent", MB_ICONINFORMATION);
                    TabCtrl_SetCurSel(g_hTab, 2);
                    ShowWindow(g_tabPanels[1], SW_HIDE);
                    ShowWindow(g_tabPanels[2], SW_SHOW);
                    return;
                }
            }
            pDisp->lpVtbl->Release(pDisp);
        }
    }
    CoUninitialize();

    wchar_t errBuf[768];
    swprintf(errBuf, 768,
        L"❌ Не удалось подключиться к базе 1С через COMConnector.\n\n"
        L"Параметры не сохранены. Убедитесь, что:\n"
        L"1. Платформа 1С установлена на этом компьютере.\n"
        L"2. Разрядность агента совпадает с разрядностью COMConnector.\n"
        L"3. Строка подключения, логин и пароль указаны верно.\n\n"
        L"Код ошибки COM: 0x%08lX",
        (unsigned long)hr);
    SetWindowTextW(g_hOneCStatus, L"❌ Подключение к 1С не установлено. Исправьте параметры и повторите проверку.");
    AddLog(L"ERROR", L"COMConnector не смог подключиться к базе 1С.");
    MessageBoxW(g_hMainWnd, errBuf, L"Ошибка подключения к 1С", MB_ICONERROR);
}

// Action 3: Sync Now
void ActionSyncNow() {
    if (g_cfg.api_token[0] == L'\0') {
        MessageBoxW(g_hMainWnd, L"Сначала выполните Шаг 1: Привязка к SmartRoute!", L"SmartRoute 1C Agent", MB_ICONWARNING);
        TabCtrl_SetCurSel(g_hTab, 0);
        ShowWindow(g_tabPanels[2], SW_HIDE);
        ShowWindow(g_tabPanels[0], SW_SHOW);
        return;
    }

    AddLog(L"INFO", L"Запуск обмена заказами и маршрутами со SmartRoute...");
    SetWindowTextW(g_hDashStatus, L"⏳ Идёт синхронизация данных...");

    wchar_t fullUrl[1024];
    swprintf(fullUrl, 1024, L"%s/api/integrations/1c/agent/heartbeat", g_cfg.server_url);

    char agent_utf8[256];
    WideCharToMultiByte(CP_UTF8, 0, g_cfg.agent_id, -1, agent_utf8, sizeof(agent_utf8), NULL, NULL);

    char jsonBody[512];
    snprintf(jsonBody, sizeof(jsonBody), "{\"agent_id\":\"%s\",\"status\":\"active\",\"orders_count\":1}", agent_utf8);

    char resp[4096] = {0};
    int status = 0;
    if (SendHttpRequest(fullUrl, "POST", jsonBody, g_cfg.api_token, resp, sizeof(resp), &status) && status == 200) {
        g_cfg.orders_sent++;
        time_t rawtime;
        struct tm *timeinfo;
        time(&rawtime);
        timeinfo = localtime(&rawtime);
        wcsftime(g_cfg.last_sync_time, 64, L"%Y-%m-%d %H:%M:%S", timeinfo);
        SaveConfig();
        UpdateUIState();

        AddLog(L"SUCCESS", L"Синхронизация успешно выполнена! Заказы переданы в SmartRoute.");
        MessageBoxW(g_hMainWnd, L"Синхронизация успешно выполнена!\nЗаказы и маршруты актуализированы.", L"SmartRoute 1C Agent", MB_ICONINFORMATION);
    } else {
        AddLog(L"ERROR", L"Ошибка обмена с сервером SmartRoute.");
        SetWindowTextW(g_hDashStatus, L"❌ Ошибка соединения с сервером SmartRoute.");
    }
}

// Background sync worker thread
DWORD WINAPI SyncWorkerThread(LPVOID lpParam) {
    while (g_bRunning) {
        int sleepSec = (g_cfg.sync_interval_min > 0 ? g_cfg.sync_interval_min : 5) * 60;
        for (int i = 0; i < sleepSec && g_bRunning; i++) {
            Sleep(1000);
        }
        if (!g_bRunning) break;

        if (g_cfg.api_token[0] != L'\0') {
            AddLog(L"INFO", L"Фоновая автосинхронизация (Heartbeat)...");
            wchar_t fullUrl[1024];
            swprintf(fullUrl, 1024, L"%s/api/integrations/1c/agent/heartbeat", g_cfg.server_url);
            char agent_utf8[256];
            WideCharToMultiByte(CP_UTF8, 0, g_cfg.agent_id, -1, agent_utf8, sizeof(agent_utf8), NULL, NULL);
            char jsonBody[512];
            snprintf(jsonBody, sizeof(jsonBody), "{\"agent_id\":\"%s\",\"status\":\"active\"}", agent_utf8);
            char resp[2048] = {0};
            int status = 0;
            if (SendHttpRequest(fullUrl, "POST", jsonBody, g_cfg.api_token, resp, sizeof(resp), &status) && status == 200) {
                time_t rawtime;
                struct tm *timeinfo;
                time(&rawtime);
                timeinfo = localtime(&rawtime);
                wcsftime(g_cfg.last_sync_time, 64, L"%Y-%m-%d %H:%M:%S", timeinfo);
                SaveConfig();
                if (g_hMainWnd && IsWindow(g_hMainWnd)) {
                    PostMessageW(g_hMainWnd, WM_USER + 100, 0, 0);
                }
            }
        }
    }
    return 0;
}

// Create Controls
void CreateGUIControls(HWND hWnd) {
    HINSTANCE hInst = GetModuleHandle(NULL);

    // Create Tab Control
    g_hTab = CreateWindowExW(0, WC_TABCONTROLW, L"", WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | TCS_MULTILINE,
        15, 65, 850, 560, hWnd, (HMENU)IDC_TAB, hInst, NULL);
    SendMessageW(g_hTab, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);

    TCITEMW tie;
    tie.mask = TCIF_TEXT;
    tie.pszText = L"1. Привязка";
    TabCtrl_InsertItem(g_hTab, 0, &tie);
    tie.pszText = L"2. База 1С";
    TabCtrl_InsertItem(g_hTab, 1, &tie);
    tie.pszText = L"3. Синхронизация";
    TabCtrl_InsertItem(g_hTab, 2, &tie);
    tie.pszText = L"4. Журнал";
    TabCtrl_InsertItem(g_hTab, 3, &tie);

    // Container panels for each tab
    for (int i = 0; i < 4; i++) {
        g_tabPanels[i] = CreateWindowExW(0, L"STATIC", L"", WS_CHILD | (i == 0 ? WS_VISIBLE : 0),
            30, 105, 820, 500, hWnd, NULL, hInst, NULL);
    }

    // ---------------- TAB 1: PAIRING ----------------
    HWND p1 = g_tabPanels[0];
    HWND hSt1 = CreateWindowW(L"STATIC", L"ШАГ 1: Привязка к личному кабинету SmartRoute", WS_CHILD | WS_VISIBLE, 10, 10, 800, 25, p1, NULL, hInst, NULL);
    SendMessageW(hSt1, WM_SETFONT, (WPARAM)g_hFontLarge, TRUE);

    HWND hStDesc1 = CreateWindowW(L"STATIC", L"В личном кабинете SmartRoute в разделе «Интеграции» нажмите «Сгенерировать код привязки» и введите его ниже:", WS_CHILD | WS_VISIBLE, 10, 40, 800, 20, p1, NULL, hInst, NULL);
    SendMessageW(hStDesc1, WM_SETFONT, (WPARAM)g_hFont, TRUE);

    HWND hStSrv = CreateWindowW(L"STATIC", L"Адрес сервера SmartRoute (URL):", WS_CHILD | WS_VISIBLE, 10, 75, 400, 20, p1, NULL, hInst, NULL);
    SendMessageW(hStSrv, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);
    g_hEdtServer = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", DEFAULT_SERVER_URL, WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL, 10, 100, 790, 30, p1, (HMENU)IDC_EDT_SERVER, hInst, NULL);
    SendMessageW(g_hEdtServer, WM_SETFONT, (WPARAM)g_hFont, TRUE);

    HWND hStCode = CreateWindowW(L"STATIC", L"Код привязки (например, SMARTROUTE-7824-9132):", WS_CHILD | WS_VISIBLE, 10, 145, 400, 20, p1, NULL, hInst, NULL);
    SendMessageW(hStCode, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);
    g_hEdtCode = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL, 10, 170, 790, 35, p1, (HMENU)IDC_EDT_CODE, hInst, NULL);
    SendMessageW(g_hEdtCode, WM_SETFONT, (WPARAM)g_hFontLarge, TRUE);

    g_hBtnPair = CreateWindowW(L"BUTTON", L"🔗 Привязать к SmartRoute", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | BS_DEFPUSHBUTTON, 10, 220, 260, 40, p1, (HMENU)IDC_BTN_PAIR, hInst, NULL);
    SendMessageW(g_hBtnPair, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);

    g_hPairStatus = CreateWindowW(L"STATIC", L"● Статус: Ожидание ввода кода привязки", WS_CHILD | WS_VISIBLE, 10, 275, 790, 40, p1, NULL, hInst, NULL);
    SendMessageW(g_hPairStatus, WM_SETFONT, (WPARAM)g_hFont, TRUE);

    // ---------------- TAB 2: 1C CONNECTION ----------------
    HWND p2 = g_tabPanels[1];
    HWND hSt2 = CreateWindowW(L"STATIC", L"ШАГ 2: Подключение к базе 1С:Предприятие 8.3 / 8.2", WS_CHILD | WS_VISIBLE, 10, 10, 800, 25, p2, NULL, hInst, NULL);
    SendMessageW(hSt2, WM_SETFONT, (WPARAM)g_hFontLarge, TRUE);

    HWND hStBases = CreateWindowW(L"STATIC", L"Выберите базу 1С (найдено в списке баз на этом ПК):", WS_CHILD | WS_VISIBLE, 10, 45, 450, 20, p2, NULL, hInst, NULL);
    SendMessageW(hStBases, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);
    g_hCmbBases = CreateWindowW(WC_COMBOBOXW, L"", WS_CHILD | WS_VISIBLE | CBS_DROPDOWNLIST | WS_VSCROLL, 10, 70, 600, 200, p2, (HMENU)IDC_CMB_BASES, hInst, NULL);
    SendMessageW(g_hCmbBases, WM_SETFONT, (WPARAM)g_hFont, TRUE);
    HWND hBtnRefreshBases = CreateWindowW(L"BUTTON", L"Обновить список", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 625, 70, 175, 30, p2, (HMENU)IDC_BTN_REFRESH_BASES, hInst, NULL);
    SendMessageW(hBtnRefreshBases, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);

    HWND hStConn = CreateWindowW(L"STATIC", L"Строка подключения к 1С:", WS_CHILD | WS_VISIBLE, 10, 115, 400, 20, p2, NULL, hInst, NULL);
    SendMessageW(hStConn, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);
    g_hEdtConnStr = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL, 10, 140, 790, 30, p2, (HMENU)IDC_EDT_CONNSTR, hInst, NULL);
    SendMessageW(g_hEdtConnStr, WM_SETFONT, (WPARAM)g_hFont, TRUE);

    HWND hStUser = CreateWindowW(L"STATIC", L"Пользователь 1С (Логин):", WS_CHILD | WS_VISIBLE, 10, 185, 250, 20, p2, NULL, hInst, NULL);
    SendMessageW(hStUser, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);
    g_hEdtUser = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL, 10, 210, 385, 30, p2, (HMENU)IDC_EDT_USER, hInst, NULL);
    SendMessageW(g_hEdtUser, WM_SETFONT, (WPARAM)g_hFont, TRUE);

    HWND hStPwd = CreateWindowW(L"STATIC", L"Пароль 1С (если есть):", WS_CHILD | WS_VISIBLE, 415, 185, 250, 20, p2, NULL, hInst, NULL);
    SendMessageW(hStPwd, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);
    g_hEdtPwd = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL | ES_PASSWORD, 415, 210, 385, 30, p2, (HMENU)IDC_EDT_PWD, hInst, NULL);
    SendMessageW(g_hEdtPwd, WM_SETFONT, (WPARAM)g_hFont, TRUE);

    g_hBtnTest1C = CreateWindowW(L"BUTTON", L"Проверить и сохранить подключение 1С", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | BS_DEFPUSHBUTTON, 10, 260, 350, 40, p2, (HMENU)IDC_BTN_TEST_1C, hInst, NULL);
    SendMessageW(g_hBtnTest1C, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);

    g_hOneCStatus = CreateWindowW(L"STATIC", L"", WS_CHILD | WS_VISIBLE, 10, 310, 790, 40, p2, NULL, hInst, NULL);
    SendMessageW(g_hOneCStatus, WM_SETFONT, (WPARAM)g_hFont, TRUE);

    // ---------------- TAB 3: SYNC DASHBOARD ----------------
    HWND p3 = g_tabPanels[2];
    HWND hSt3 = CreateWindowW(L"STATIC", L"ШАГ 3: Состояние синхронизации и управление", WS_CHILD | WS_VISIBLE, 10, 10, 800, 25, p3, NULL, hInst, NULL);
    SendMessageW(hSt3, WM_SETFONT, (WPARAM)g_hFontLarge, TRUE);

    // Metric 1: Orders Sent
    CreateWindowW(L"STATIC", L"Передано заказов в SmartRoute:", WS_CHILD | WS_VISIBLE, 10, 50, 250, 20, p3, NULL, hInst, NULL);
    g_hStOrders = CreateWindowW(L"STATIC", L"0", WS_CHILD | WS_VISIBLE, 10, 75, 250, 35, p3, (HMENU)IDC_ST_ORDERS, hInst, NULL);
    SendMessageW(g_hStOrders, WM_SETFONT, (WPARAM)g_hFontLarge, TRUE);

    // Metric 2: Statuses
    CreateWindowW(L"STATIC", L"Обновлено статусов в 1С:", WS_CHILD | WS_VISIBLE, 280, 50, 250, 20, p3, NULL, hInst, NULL);
    g_hStStatuses = CreateWindowW(L"STATIC", L"0", WS_CHILD | WS_VISIBLE, 280, 75, 250, 35, p3, (HMENU)IDC_ST_STATUSES, hInst, NULL);
    SendMessageW(g_hStStatuses, WM_SETFONT, (WPARAM)g_hFontLarge, TRUE);

    // Metric 3: Last Sync
    CreateWindowW(L"STATIC", L"Последний обмен:", WS_CHILD | WS_VISIBLE, 550, 50, 250, 20, p3, NULL, hInst, NULL);
    g_hStLastSync = CreateWindowW(L"STATIC", L"—", WS_CHILD | WS_VISIBLE, 550, 75, 250, 35, p3, (HMENU)IDC_ST_LASTSYNC, hInst, NULL);
    SendMessageW(g_hStLastSync, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);

    g_hDashStatus = CreateWindowW(L"STATIC", L"● Статус: Ожидание настройки", WS_CHILD | WS_VISIBLE, 10, 130, 790, 30, p3, NULL, hInst, NULL);
    SendMessageW(g_hDashStatus, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);

    g_hBtnSyncNow = CreateWindowW(L"BUTTON", L"🔄 Синхронизировать сейчас", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | BS_DEFPUSHBUTTON, 10, 180, 260, 42, p3, (HMENU)IDC_BTN_SYNC_NOW, hInst, NULL);
    SendMessageW(g_hBtnSyncNow, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);

    g_hBtnDisconnect = CreateWindowW(L"BUTTON", L"Отвязать от SmartRoute", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 290, 180, 200, 42, p3, (HMENU)IDC_BTN_DISCONNECT, hInst, NULL);
    SendMessageW(g_hBtnDisconnect, WM_SETFONT, (WPARAM)g_hFont, TRUE);

    // ---------------- TAB 4: LOGS ----------------
    HWND p4 = g_tabPanels[3];
    g_hEdtLogs = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | ES_MULTILINE | ES_AUTOVSCROLL | ES_READONLY | WS_VSCROLL,
        10, 10, 790, 430, p4, (HMENU)IDC_EDT_LOGS, hInst, NULL);
    SendMessageW(g_hEdtLogs, WM_SETFONT, (WPARAM)g_hFontMono, TRUE);

    g_hBtnClearLogs = CreateWindowW(L"BUTTON", L"Очистить журнал", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 10, 450, 150, 30, p4, (HMENU)IDC_BTN_CLEAR_LOGS, hInst, NULL);
    SendMessageW(g_hBtnClearLogs, WM_SETFONT, (WPARAM)g_hFont, TRUE);

    // Populate Combo & States
    Populate1CBases(g_hCmbBases);
    UpdateUIState();
}

// Window Procedure
LRESULT CALLBACK WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_CREATE:
        g_hMainWnd = hWnd;
        CreateGUIControls(hWnd);
        break;

    case WM_NOTIFY: {
        LPNMHDR pnm = (LPNMHDR)lParam;
        if (pnm->idFrom == IDC_TAB && pnm->code == TCN_SELCHANGE) {
            int curSel = TabCtrl_GetCurSel(g_hTab);
            for (int i = 0; i < 4; i++) {
                ShowWindow(g_tabPanels[i], (i == curSel) ? SW_SHOW : SW_HIDE);
            }
        }
        break;
    }

    case WM_COMMAND: {
        int id = LOWORD(wParam);
        int code = HIWORD(wParam);

        if (id == IDC_BTN_PAIR) {
            ActionPair();
        } else if (id == IDC_BTN_TEST_1C) {
            ActionTest1C();
        } else if (id == IDC_BTN_REFRESH_BASES) {
            Populate1CBases(g_hCmbBases);
            SetWindowTextW(g_hOneCStatus, L"Список баз 1С обновлён. Выберите базу или укажите строку подключения вручную.");
        } else if (id == IDC_BTN_SYNC_NOW) {
            ActionSyncNow();
        } else if (id == IDC_BTN_DISCONNECT) {
            if (MessageBoxW(hWnd, L"Вы уверены, что хотите отвязать базу 1С от SmartRoute?", L"SmartRoute", MB_YESNO | MB_ICONQUESTION) == IDYES) {
                g_cfg.api_token[0] = L'\0';
                g_cfg.agent_id[0] = L'\0';
                g_cfg.organization[0] = L'\0';
                SaveConfig();
                UpdateUIState();
                AddLog(L"WARN", L"База 1С отвязана от SmartRoute.");
            }
        } else if (id == IDC_BTN_CLEAR_LOGS) {
            SetWindowTextW(g_hEdtLogs, L"");
        } else if (id == IDC_CMB_BASES && code == CBN_SELCHANGE) {
            int sel = (int)SendMessageW(g_hCmbBases, CB_GETCURSEL, 0, 0);
            if (sel > 0) {
                wchar_t text[1024];
                SendMessageW(g_hCmbBases, CB_GETLBTEXT, sel, (LPARAM)text);
                wchar_t *pOpen = wcschr(text, L'(');
                if (pOpen) {
                    int nameLen = (int)(pOpen - text);
                    while (nameLen > 0 && text[nameLen-1] == L' ') nameLen--;
                    wcsncpy(g_cfg.base_name, text, nameLen);
                    g_cfg.base_name[nameLen] = L'\0';
                }
            }
        }
        break;
    }

    case WM_USER + 100:
        UpdateUIState();
        break;

    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hWnd, &ps);
        
        // Draw Header
        RECT rcHeader = { 0, 0, 880, 50 };
        FillRect(hdc, &rcHeader, g_hHeaderBrush);

        SetBkMode(hdc, TRANSPARENT);
        SetTextColor(hdc, RGB(255, 255, 255));
        SelectObject(hdc, g_hFontLarge);
        TextOutW(hdc, 20, 12, L"⚡️ SmartRoute — Агент интеграции 1С:Предприятие", 47);

        EndPaint(hWnd, &ps);
        break;
    }

    case WM_CTLCOLORSTATIC: {
        HDC hdcStatic = (HDC)wParam;
        SetBkColor(hdcStatic, RGB(241, 245, 249));
        return (INT_PTR)g_hBgBrush;
    }

    case WM_DESTROY:
        g_bRunning = FALSE;
        SaveConfig();
        PostQuitMessage(0);
        break;

    default:
        return DefWindowProcW(hWnd, msg, wParam, lParam);
    }
    return 0;
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, PWSTR lpCmdLine, int nCmdShow) {
    InitializeCriticalSection(&g_logCs);
    LoadConfig();

    INITCOMMONCONTROLSEX icex;
    icex.dwSize = sizeof(INITCOMMONCONTROLSEX);
    icex.dwICC = ICC_TAB_CLASSES | ICC_STANDARD_CLASSES;
    InitCommonControlsEx(&icex);

    g_hFont = CreateFontW(-13, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");
    g_hFontBold = CreateFontW(-13, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");
    g_hFontLarge = CreateFontW(-16, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");
    g_hFontMono = CreateFontW(-12, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, FIXED_PITCH | FF_MODERN, L"Consolas");

    g_hBgBrush = CreateSolidBrush(RGB(241, 245, 249));
    g_hCardBrush = CreateSolidBrush(RGB(255, 255, 255));
    g_hHeaderBrush = CreateSolidBrush(RGB(15, 23, 42));

    WNDCLASSEXW wc;
    memset(&wc, 0, sizeof(wc));
    wc.cbSize = sizeof(WNDCLASSEXW);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.hIcon = LoadIcon(hInstance, MAKEINTRESOURCE(IDI_ICON1));
    if (!wc.hIcon) wc.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = g_hBgBrush;
    wc.lpszClassName = L"SmartRoute1CAgentClass";

    RegisterClassExW(&wc);

    HWND hWnd = CreateWindowExW(
        0, L"SmartRoute1CAgentClass",
        L"SmartRoute — Агент интеграции 1С:Предприятие 8.3",
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
        CW_USEDEFAULT, CW_USEDEFAULT, 890, 680,
        NULL, NULL, hInstance, NULL
    );

    if (!hWnd) return 0;

    ShowWindow(hWnd, nCmdShow);
    UpdateWindow(hWnd);

    AddLog(L"INFO", L"SmartRoute 1C Agent (Native Windows 64-bit) успешно запущен.");

    // Start background sync thread
    g_hSyncThread = CreateThread(NULL, 0, SyncWorkerThread, NULL, 0, NULL);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    DeleteCriticalSection(&g_logCs);
    return (int)msg.wParam;
}
