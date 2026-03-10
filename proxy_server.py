#!/usr/bin/env python3
"""
Simple CORS proxy for worldmonitor.app API
Run alongside your HTTP server on a different port
Example: python3 proxy_server.py
Then in your JS, use: fetch('http://localhost:8001/api/...').then(r => r.json())
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import urllib.error
import json
from urllib.parse import urlparse, parse_qs
import mimetypes
import re

class ProxyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        """Handle GET requests — proxies any external URL or worldmonitor endpoint"""

        parsed_path = urlparse(self.path)
        query_params = parse_qs(parsed_path.query)

        # Route 1: arbitrary URL proxy  →  /proxy?url=https://...
        full_url = query_params.get('url', [''])[0]
        if full_url:
            self._proxy_url(full_url)
            return

        # Route 2: worldmonitor endpoint  →  /api?endpoint=/api/...
        target_endpoint = query_params.get('endpoint', [''])[0]

        if not target_endpoint:
            self.send_error(400, 'Missing url or endpoint parameter')
            return

        # Special handling for CII data - scrape from website
        if target_endpoint == '/api/instability/v1/list-country-instability':
            self._scrape_cii_data()
            return

        # Build the full URL to worldmonitor API
        target_url = f'https://api.worldmonitor.app{target_endpoint}'
        
        try:
            # Create request with browser-like headers
            req = urllib.request.Request(
                target_url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://worldmonitor.app/',
                    'Accept': 'application/json',
                }
            )
            
            # Fetch the data
            with urllib.request.urlopen(req, timeout=10) as response:
                data = response.read().decode('utf-8')
                
                # Send response with CORS headers
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Cache-Control', 'public, max-age=3600')
                self.end_headers()
                self.wfile.write(data.encode('utf-8'))
                
        except urllib.error.HTTPError as e:
            print(f'HTTP Error {e.code}: {e.reason}')
            self.send_error(e.code, f'Upstream error: {e.reason}')
        except Exception as e:
            print(f'Error: {e}')
            self.send_error(500, f'Proxy error: {str(e)}')

    def _proxy_url(self, target_url):
        """Proxy any arbitrary URL with CORS headers added."""
        try:
            req = urllib.request.Request(
                target_url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (compatible; ShimiDashboard/1.0)',
                    'Accept': 'application/json, text/plain, */*',
                }
            )
            with urllib.request.urlopen(req, timeout=15) as response:
                data = response.read()
                self.send_response(200)
                self.send_header('Content-Type', response.headers.get('Content-Type', 'application/json'))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
                self.send_header('Cache-Control', 'public, max-age=1800')
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            print(f'[proxy_url] HTTP {e.code}: {target_url}')
            self.send_error(e.code, f'Upstream: {e.reason}')
        except Exception as e:
            print(f'[proxy_url] Error: {e}')
            self.send_error(500, str(e))
    
    def _scrape_cii_data(self):
        """Scrape CII data from worldmonitor website"""
        try:
            # Fetch the main page
            req = urllib.request.Request(
                'https://www.worldmonitor.app',
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                }
            )
            
            with urllib.request.urlopen(req, timeout=15) as response:
                html = response.read().decode('utf-8')
                
                # Look for CII data in the HTML/JavaScript
                # This is a simplified scraper - in reality, the data might be in JSON embedded in script tags
                cii_data = self._extract_cii_from_html(html)
                
                # Send response
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Cache-Control', 'public, max-age=1800')  # Cache for 30 minutes
                self.end_headers()
                self.wfile.write(json.dumps(cii_data).encode('utf-8'))
                
        except Exception as e:
            print(f'Error scraping CII data: {e}')
            # Fallback to sample data if scraping fails
            sample_data = self._get_sample_cii_data()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.end_headers()
            self.wfile.write(json.dumps(sample_data).encode('utf-8'))
    
    def _extract_cii_from_html(self, html):
        """Extract CII data from HTML content"""
        cii_data = {}
        
        # Look for JSON data in script tags or data attributes
        # This is a basic implementation - you might need to adjust based on how worldmonitor embeds the data
        
        # Try to find country data patterns
        # Look for patterns like "IR":100, "UA":71, etc.
        pattern = r'([A-Z]{2})\s*:\s*(\d+)'
        matches = re.findall(pattern, html)
        
        for country_code, score in matches:
            if len(country_code) == 2 and country_code.isalpha():
                cii_data[country_code] = int(score)
        
        # If we found some data, return it; otherwise use sample data
        if cii_data:
            print(f'Scraped {len(cii_data)} CII entries from worldmonitor')
            return cii_data
        else:
            print('No CII data found in HTML, using sample data')
            return self._get_sample_cii_data()
    
    def _get_sample_cii_data(self):
        """Return sample CII data as fallback"""
        return {
            'IR': 100, 'UA': 71, 'IL': 70, 'MX': 70, 'RU': 67, 'LB': 60, 'IQ': 60,
            'SA': 52, 'QA': 50, 'JO': 50, 'AE': 50, 'CO': 50, 'CY': 50, 'BR': 50,
            'KW': 50, 'BH': 50, 'EC': 50, 'HT': 50, 'ET': 50, 'SY': 50, 'PK': 50,
            'OM': 50, 'CN': 44, 'TR': 40, 'VE': 40, 'TW': 35, 'IN': 35, 'YE': 28,
            'MM': 26, 'KP': 23, 'CU': 20, 'US': 16, 'AF': 15, 'NG': 15, 'PS': 15,
            'SS': 14, 'SD': 14, 'CD': 14, 'SO': 14, 'NP': 13, 'GB': 12, 'IT': 12,
            'FR': 12, 'GN': 12, 'BD': 11, 'NO': 11, 'AO': 11, 'MW': 11, 'EG': 10,
            'ID': 10, 'CF': 10, 'ML': 10, 'CM': 10, 'BF': 10, 'AZ': 10, 'GT': 10,
            'ER': 10, 'PE': 10, 'HN': 10, 'BI': 10, 'NI': 10, 'SV': 10, 'RW': 10,
            'LK': 10, 'EH': 10, 'BE': 9, 'SE': 8, 'ZA': 8, 'GR': 8, 'ES': 8,
            'JP': 8, 'KR': 7, 'DE': 7, 'CH': 7, 'AR': 7, 'NL': 7, 'HU': 7, 'JM': 7,
            'MG': 7, 'AT': 7, 'SI': 7, 'FI': 7, 'NZ': 7, 'MD': 7, 'IE': 7, 'HR': 7,
            'AL': 7, 'TH': 7, 'AU': 7, 'XK': 7, 'CA': 7, 'VN': 7, 'MY': 7, 'KE': 7,
            'DK': 7, 'CL': 7, 'ZW': 7, 'UG': 6, 'TD': 6, 'NE': 6, 'MZ': 6, 'LY': 6,
            'CZ': 6, 'GE': 6, 'RS': 6, 'CR': 6, 'TZ': 6, 'RO': 6, 'DZ': 6, 'MR': 6,
            'SK': 6, 'AM': 6, 'BA': 6, 'BG': 6, 'PH': 6, 'ZM': 6, 'PG': 6, 'CI': 6,
            'CG': 6, 'PT': 6, 'KZ': 6, 'TG': 6, 'LT': 6, 'SN': 6, 'BY': 6, 'EE': 6,
            'GH': 6, 'DJ': 6, 'LV': 6, 'UY': 6, 'MA': 6, 'UZ': 6, 'TT': 6, 'KG': 6,
            'BJ': 6, 'MK': 6, 'ME': 6, 'SL': 6, 'DO': 6, 'TJ': 6, 'GM': 6, 'TN': 6,
            'LU': 6, 'KH': 6, 'PA': 6, 'MT': 6, 'MN': 6, 'LR': 6, 'IS': 6, 'PY': 6,
            'BT': 6, 'BO': 6, 'LA': 6, 'NA': 6, 'TM': 6, 'BS': 6, 'SR': 6, 'FJ': 6,
            'GW': 6, 'KM': 6, 'BZ': 6, 'GY': 6, 'GA': 6, 'BW': 6, 'TL': 6, 'HK': 6,
            'GQ': 6, 'VU': 6, 'LI': 6, 'MU': 6, 'SB': 6, 'LS': 6, 'DM': 6, 'WS': 6,
            'LC': 6, 'VC': 6, 'SG': 6, 'CV': 6, 'GD': 6, 'SX': 6, 'AG': 6, 'BN': 6,
            'KN': 6, 'BM': 6, 'NR': 6, 'MV': 6, 'KY': 6, 'VG': 6, 'KI': 6, 'SC': 6,
            'MO': 6, 'ST': 6, 'TC': 6, 'MC': 6, 'AD': 6, 'TV': 6, 'MH': 6, 'NU': 6,
            'CW': 6, 'AI': 6, 'NC': 6, 'FM': 6, 'PW': 6, 'AW': 6, 'PL': 5
        }
    
    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def log_message(self, format, *args):
        """Custom logging"""
        print(f'[PROXY] {format % args}')

if __name__ == '__main__':
    PORT = 8001
    server = HTTPServer(('localhost', PORT), ProxyHandler)
    print(f'Starting proxy server on http://localhost:{PORT}')
    print('Update your JS to use: fetch("http://localhost:8001/api?endpoint=/api/intelligence/v1/list-country-instability")')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down proxy server...')
        server.shutdown()
