// Define the region of interest (ROI) to include all of Den Haag
var roi = ee.Geometry.Polygon(
  [[[4.190582275390625, 52.056153123850086],
    [4.190582275390625, 52.12754866863592],
    [4.3878173828125, 52.12754866863592],
    [4.3878173828125, 52.056153123850086]]]);

// Load the built-up surface images for 1975 and 2020 from the JRC GHSL dataset
var builtUp1975 = ee.Image('JRC/GHSL/P2016/BUILT_LDSMT_GLOBE_V1/1975')
  .select('built')
  .clip(roi);

var builtUp2020 = ee.Image('JRC/GHSL/P2016/BUILT_LDSMT_GLOBE_V1/2014')
  .select('built')
  .clip(roi);

// Set appropriate visualization parameters
var visParams = {
  min: 0,
  max: 1,
  palette: ['000000', 'ff0000']
};

// Center the map on Den Haag with a zoom level that appropriately displays the area
Map.setCenter(4.3007, 52.0705, 12);

// Add the built-up surface layers for 1975 and 2020 to the map
Map.addLayer(builtUp1975, visParams, 'Built-up Surface 1975');
Map.addLayer(builtUp2020, visParams, 'Built-up Surface 2020');

// Export both images to Google Drive as GeoTIFF files
Export.image.toDrive({
  image: builtUp1975,
  description: 'BuiltUp1975_DenHaag',
  scale: 30,
  region: roi,
  fileFormat: 'GeoTIFF'
});

Export.image.toDrive({
  image: builtUp2020,
  description: 'BuiltUp2020_DenHaag',
  scale: 30,
  region: roi,
  fileFormat: 'GeoTIFF'
});
