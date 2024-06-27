// Define the region of interest (ROI) for Den Haag
var denHaag = ee.Geometry.Rectangle([4.12, 51.94, 4.470, 52.123]);

// Load the built-up surface images for 1975 and 2020 from the JRC GHSL dataset
var image_1975 = ee.Image('JRC/GHSL/P2023A/GHS_BUILT_S/1975');
var built_1975 = image_1975.select('built_surface').clip(denHaag);

var image_2020 = ee.Image('JRC/GHSL/P2023A/GHS_BUILT_S/2020');
var built_2020 = image_2020.select('built_surface').clip(denHaag);

// Define visualization parameters
var visParams = {
  min: 0.0,
  max: 8000.0,
  palette: ['000000', 'FFFFFF']
};

// Set the center of the map to Den Haag area with zoom level 12
Map.setCenter(4.33, 52.0, 11);

// Add the built-up surface layers to the map
Map.addLayer(built_1975, visParams, 'Built-up surface [m²], 1975');
Map.addLayer(built_2020, visParams, 'Built-up surface [m²], 2020');

// Export the 1975 image to Google Drive
Export.image.toDrive({
  image: built_1975,
  description: 'Built_up_surface_Den_Haag_1975',
  scale: 30, // Adjust the scale as needed
  region: denHaag,
  maxPixels: 1e9
});

// Export the 2020 image to Google Drive
Export.image.toDrive({
  image: built_2020,
  description: 'Built_up_surface_Den_Haag_2020',
  scale: 30, // Adjust the scale as needed
  region: denHaag,
  maxPixels: 1e9
});"
