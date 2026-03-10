// api/worldmonitor.js - Proxy endpoint for worldmonitor.app data
export default async function handler(req, res) {
  const { endpoint } = req.query;
  
  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint parameter' });
  }

  try {
    const response = await fetch(`https://api.worldmonitor.app${endpoint}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GeoWatch/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    
    // Cache for 1 hour
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Failed to fetch data', details: error.message });
  }
}