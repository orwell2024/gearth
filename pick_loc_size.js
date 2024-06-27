// Define the location and size (in kilometers) for the region of interest
var latitude = 51.501236841201475;
var longitude = -0.132991009533428;
 
var sizeKm = 70; // Size of the cell in kilometers (one side length)

// Load the built-up surface images for 1975 and 2020 from the JRC GHSL dataset
var image_1975 = ee.Image('JRC/GHSL/P2023A/GHS_BUILT_S/1975');
var built_1975 = image_1975.select('built_surface');

var image_2020 = ee.Image('JRC/GHSL/P2023A/GHS_BUILT_S/2020');
var built_2020 = image_2020.select('built_surface');

// Define visualization parameters
var visParams = {
  min: 0.0,
  max: 100.0,
  palette: ['000000', 'FFFFFF']
};

// Set the center of the map to the specified area with zoom level 12
Map.setCenter(longitude, latitude, 12);

// Define a point for the center of the rectangle at the specified coordinates
var centerPoint = ee.Geometry.Point([longitude, latitude]);

// Create a bounding box around the center point
var halfSideLength = (sizeKm / 2) * 1000; // Convert km to meters
var cell = centerPoint.buffer(halfSideLength).bounds();

// Clip the built-up images to the cell
var built_1975_clipped = built_1975.clip(cell);
var built_2020_clipped = built_2020.clip(cell);

// Calculate the average built-up value for the cell in 1975
var mean1975 = built_1975.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: cell,
  scale: 30,
  maxPixels: 1e9
}).get('built_surface');

// Calculate the average built-up value for the cell in 2020
var mean2020 = built_2020.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: cell,
  scale: 30,
  maxPixels: 1e9
}).get('built_surface');

// Normalize to percentage of the area (1% = 10,000 square meters per hectare)
var percentage1975 = ee.Number(mean1975).divide(10000).multiply(100);
var percentage2020 = ee.Number(mean2020).divide(10000).multiply(100);

// Print the results to the console
print('Built-up surface percentage in 1975 for the ' + sizeKm + ' km cell:', percentage1975.getInfo());
print('Built-up surface percentage in 2020 for the ' + sizeKm + ' km cell:', percentage2020.getInfo());

// Add the built-up surface layers to the map, normalized to percent
var built_1975_clipped_percent = built_1975_clipped.divide(10000).multiply(100);
var built_2020_clipped_percent = built_2020_clipped.divide(10000).multiply(100);

Map.addLayer(built_1975_clipped_percent, visParams, 'Built-up surface [%], 1975');
Map.addLayer(built_2020_clipped_percent, visParams, 'Built-up surface [%], 2020');

// Add the cell to the map
Map.addLayer(cell, {color: 'blue'}, sizeKm + ' km cell');

// Export the 1975 image to Google Drive
Export.image.toDrive({
  image: built_1975_clipped_percent,
  description: 'Built_up_surface_1975_' + sizeKm + 'km_cell_percent',
  scale: 30, // Adjust the scale as needed
  region: cell,
  maxPixels: 1e9
});

// Export the 2020 image to Google Drive
Export.image.toDrive({
  image: built_2020_clipped_percent,
  description: 'Built_up_surface_2020_' + sizeKm + 'km_cell_percent',
  scale: 30, // Adjust the scale as needed
  region: cell,
  maxPixels: 1e9
});
