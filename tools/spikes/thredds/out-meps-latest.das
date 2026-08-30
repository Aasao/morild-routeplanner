Attributes {
    time {
        String long_name "time";
        String standard_name "time";
        String units "seconds since 1970-01-01 00:00:00 +00:00";
        UInt32 _ChunkSizes 512;
    }
    forecast_reference_time {
        String units "seconds since 1970-01-01 00:00:00 +00:00";
        String standard_name "forecast_reference_time";
    }
    ensemble_member {
        String long_name "ensemble run number";
        String standard_name "realization";
    }
    pressure {
        String description "pressure";
        String long_name "pressure";
        String standard_name "air_pressure";
        String positive "down";
        String units "hPa";
    }
    height_above_msl {
        String description "height above MSL";
        String long_name "height";
        String positive "up";
        String units "m";
    }
    height0 {
        String description "height above ground";
        String long_name "height";
        String positive "up";
        String units "m";
    }
    height1 {
        String description "height above ground";
        String long_name "height";
        String positive "up";
        String units "m";
    }
    height2 {
        String description "height above ground";
        String long_name "height";
        String positive "up";
        String units "m";
    }
    projection_lambert {
        String grid_mapping_name "lambert_conformal_conic";
        Float64 standard_parallel 63.3, 63.3;
        Float64 longitude_of_central_meridian 15.0;
        Float64 latitude_of_projection_origin 63.3;
        Float64 earth_radius 6371000.0;
    }
    x {
        String long_name "x-coordinate in Cartesian system";
        String standard_name "projection_x_coordinate";
        String units "m";
    }
    y {
        String long_name "y-coordinate in Cartesian system";
        String standard_name "projection_y_coordinate";
        String units "m";
    }
    longitude {
        String units "degree_east";
        String long_name "longitude";
        String standard_name "longitude";
    }
    latitude {
        String units "degree_north";
        String long_name "latitude";
        String standard_name "latitude";
    }
    x_wind_pl {
        Float32 _FillValue 9.96921E36;
        String long_name "Wind along x-coordinate on pressure levels";
        String standard_name "x_wind";
        String units "m/s";
        String grid_mapping "projection_lambert";
        String coordinates "longitude latitude";
        UInt32 _ChunkSizes 1, 1, 10, 357, 317;
    }
    y_wind_pl {
        Float32 _FillValue 9.96921E36;
        String long_name "Wind along y-coordinate on pressure levels";
        String standard_name "y_wind";
        String units "m/s";
        String grid_mapping "projection_lambert";
        String coordinates "longitude latitude";
        UInt32 _ChunkSizes 1, 1, 10, 357, 317;
    }
    air_temperature_pl {
        Float32 _FillValue 9.96921E36;
        String long_name "Air temperature pressure levels";
        String standard_name "air_temperature";
        String units "K";
        String grid_mapping "projection_lambert";
        String coordinates "longitude latitude";
        UInt32 _ChunkSizes 1, 1, 10, 357, 317;
    }
    air_temperature_2m {
        Float32 _FillValue 9.96921E36;
        String long_name "Screen level temperature (T2M)";
        String standard_name "air_temperature";
        String units "K";
        String grid_mapping "projection_lambert";
        String coordinates "longitude latitude";
        UInt32 _ChunkSizes 1, 1, 10, 357, 317;
    }
    relative_humidity_2m {
        Float32 _FillValue 9.96921E36;
        String long_name "Screen level relative humidity (RH2M)";
        String standard_name "relative_humidity";
        String units "1";
        String grid_mapping "projection_lambert";
        String coordinates "longitude latitude";
        UInt32 _ChunkSizes 1, 1, 10, 357, 317;
    }
    x_wind_10m {
        Float32 _FillValue 9.96921E36;
        String long_name "10 metre wind along x-coordinate (U10M)";
        String standard_name "x_wind";
        String units "m/s";
        String grid_mapping "projection_lambert";
        String coordinates "longitude latitude";
        UInt32 _ChunkSizes 1, 1, 10, 357, 317;
    }
    y_wind_10m {
        Float32 _FillValue 9.96921E36;
        String long_name "10 metre wind along y-coordinate (V10M)";
        String standard_name "y_wind";
        String units "m/s";
        String grid_mapping "projection_lambert";
        String coordinates "longitude latitude";
        UInt32 _ChunkSizes 1, 1, 10, 357, 317;
    }
    cloud_area_fraction {
        Float32 _FillValue 9.96921E36;
        String long_name "Total cloud cover (TCC)";
        String standard_name "cloud_area_fraction";
        String units "1";
        String grid_mapping "projection_lambert";
        String coordinates "longitude latitude";
        UInt32 _ChunkSizes 1, 1, 10, 357, 317;
    }
    air_pressure_at_sea_level {
        Float32 _FillValue 9.96921E36;
        String long_name "Mean Sea Level Pressure (MSLP)";
        String standard_name "air_pressure_at_sea_level";
        String units "Pa";
        String grid_mapping "projection_lambert";
        String coordinates "longitude latitude";
        UInt32 _ChunkSizes 1, 1, 10, 357, 317;
    }
    precipitation_amount_acc {
        Float32 _FillValue 9.96921E36;
        String long_name "Accumulated total precipitation";
        String standard_name "precipitation_amount";
        String units "kg/m^2";
        String grid_mapping "projection_lambert";
        String coordinates "longitude latitude";
        UInt32 _ChunkSizes 1, 1, 10, 357, 317;
    }
    snowfall_amount_acc {
        Float32 _FillValue 9.96921E36;
        String long_name "Total accumulated solid precipitation (snow+graupel+hail)";
        String standard_name "snowfall_amount";
        String units "kg/m^2";
        String grid_mapping "projection_lambert";
        String coordinates "longitude latitude";
        UInt32 _ChunkSizes 1, 1, 10, 357, 317;
    }
    wind_speed_of_gust {
        Float32 _FillValue 9.96921E36;
        String long_name "Wind gust";
        String standard_name "wind_speed_of_gust";
        String units "m/s";
        String grid_mapping "projection_lambert";
        String coordinates "longitude latitude";
        UInt32 _ChunkSizes 1, 1, 10, 357, 317;
    }
    fog_area_fraction {
        Float32 _FillValue 9.96921E36;
        String long_name "Fog";
        String metno_name "fog_area_fraction";
        String units "1";
        String grid_mapping "projection_lambert";
        String coordinates "longitude latitude";
        UInt32 _ChunkSizes 1, 1, 10, 357, 317;
    }
    NC_GLOBAL {
        String Conventions "CF-1.6";
        String institution "Norwegian Meteorological Institute, MET Norway";
        String creator_url "met.no";
        String source "MEPS 2.5km";
        String min_time "2026-09-02 03:00:00Z";
        String max_time "2026-09-02";
        String geospatial_lat_min "49.8";
        String geospatial_lat_max "75.2";
        String geospatial_lon_min "-18.1";
        String geospatial_lon_max "54.2";
        String references "unknown";
        String license "https://www.met.no/en/free-meteorological-data/Licensing-and-crediting";
        String comment "For more information, please visit https://github.com/metno/NWPdocs/wiki";
        String history "2026-08-30T16:45:04 creation by fimex";
    }
    DODS_EXTRA {
        String Unlimited_Dimension "time";
    }
}
