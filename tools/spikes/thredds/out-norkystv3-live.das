Attributes {
    h {
        String units "meter";
        String grid "grid";
        String location "face";
        String grid_mapping "projection_stere";
        String long_name "sea_floor_depth_below_sea_level";
        String standard_name "sea_floor_depth_below_sea_level";
        String coordinates "lon lat";
        String field "bath, scalar";
        UInt32 _ChunkSizes 24, 2747;
    }
    lon {
        String units "degree_east";
        String grid_mapping "projection_stere";
        String standard_name "longitude";
        String field "lon, scalar";
        String long_name "longitude";
        UInt32 _ChunkSizes 24, 2747;
    }
    lat {
        String units "degree_north";
        String grid_mapping "projection_stere";
        String standard_name "latitude";
        String field "lat, scalar";
        String long_name "latitude";
        UInt32 _ChunkSizes 24, 2747;
    }
    projection_stere {
        String grid_mapping_name "polar_stereographic";
        Float64 straight_vertical_longitude_from_pole 70.0;
        Float64 latitude_of_projection_origin 90.0;
        Float64 false_northing 1844800.0;
        Float64 false_easting 3369600.0;
        Float64 semi_major_axis 6378137.0;
        Float64 semi_minor_axis 6356752.3142;
        Float64 standard_parallel 60.0;
        String proj4 "+proj=stere +lat_0=90 +lat_ts=60 +lon_0=70 +x_0=3369600 +y_0=1844800 +a=6378137 +b=6356752.3142 +units=m +no_defs +type=crs";
    }
    X {
        String long_name "x-coordinate in Cartesian system";
        String axis "X";
        String standard_name "projection_x_coordinate";
        String units "meter";
        UInt32 _ChunkSizes 2747;
    }
    Y {
        String long_name "y-coordinate in Cartesian system";
        String axis "Y";
        String standard_name "projection_y_coordinate";
        String units "meter";
        UInt32 _ChunkSizes 1148;
    }
    depth {
        String positive "down";
        String axis "Z";
        String standard_name "depth";
        String long_name "depth";
        String units "meter";
        UInt32 _ChunkSizes 15;
    }
    forecast_reference_time {
        String standard_name "forecast_reference_time";
        String coordinates "time";
        String units "seconds since 1970-01-01 00:00:00";
        String long_name "forecast_reference_time";
    }
    time {
        String long_name "time since initialization";
        String units "seconds since 1970-01-01 00:00:00";
        String axis "T";
        String standard_name "time";
        String field "time, scalar, series";
        String calendar "gregorian";
        UInt32 _ChunkSizes 1;
    }
    zeta {
        String units "meter";
        String cell_methods "ocean_time: point";
        String grid "grid";
        String location "face";
        String grid_mapping "projection_stere";
        Int16 _FillValue -32767;
        Float32 add_offset 0.0;
        Float32 scale_factor 0.001;
        String long_name "Sea surface height above geoid";
        String standard_name "sea_surface_elevation";
        String coordinates "lon lat";
        String field "free-surface, scalar, series";
        String time "time";
        UInt32 _ChunkSizes 1, 24, 2747;
    }
    u_eastward {
        String units "meter second-1";
        String cell_methods "ocean_time: point";
        String standard_name "eastward_sea_water_velocity";
        String grid "grid";
        String grid_mapping "projection_stere";
        Int16 _FillValue -32767;
        Float32 add_offset 0.0;
        Float32 scale_factor 0.001;
        String long_name "Sea water eastward velocity";
        String coordinates "lon lat";
        String location "edge1";
        String field "u-velocity, scalar, series";
        String time "time";
        String minmax "-2 2";
        UInt32 _ChunkSizes 1, 1, 24, 2747;
    }
    v_northward {
        String units "meter second-1";
        String cell_methods "ocean_time: point";
        String standard_name "northward_sea_water_velocity";
        String grid "grid";
        String grid_mapping "projection_stere";
        Int16 _FillValue -32767;
        Float32 add_offset 0.0;
        Float32 scale_factor 0.001;
        String long_name "Sea water northward velocity";
        String coordinates "lon lat";
        String location "edge2";
        String field "v-velocity, scalar, series";
        String time "time";
        String minmax "-2 2";
        UInt32 _ChunkSizes 1, 1, 24, 2747;
    }
    w {
        String units "meter second-1";
        String cell_methods "ocean_time: point";
        String standard_name "upward_sea_water_velocity";
        String grid "grid";
        String location "face";
        String grid_mapping "projection_stere";
        Int16 _FillValue -32767;
        Float32 add_offset 0.0;
        Float32 scale_factor 1.0E-5;
        String long_name "Sea water z velocity";
        String coordinates "lon lat";
        String field "w-velocity, scalar, series";
        String time "time";
        UInt32 _ChunkSizes 1, 1, 24, 2747;
    }
    temperature {
        String units "Celsius";
        String cell_methods "ocean_time: point";
        String standard_name "sea_water_potential_temperature";
        String grid "grid";
        String location "face";
        String grid_mapping "projection_stere";
        Int16 _FillValue -32767;
        Float32 add_offset 10.0;
        Float32 scale_factor 0.001;
        String long_name "Sea water potential temperature";
        String coordinates "lon lat";
        String field "temperature, scalar, series";
        String time "time";
        String minmax "-2 25";
        UInt32 _ChunkSizes 1, 1, 24, 2747;
    }
    salinity {
        String cell_methods "ocean_time: point";
        String grid "grid";
        String location "face";
        String grid_mapping "projection_stere";
        Int16 _FillValue -32767;
        Float32 add_offset 30.0;
        Float32 scale_factor 0.001;
        String long_name "Sea water salinity";
        String standard_name "sea_water_salinity";
        String units "1e-3";
        String coordinates "lon lat";
        String field "salinity, scalar, series";
        String time "time";
        String minmax "10 40";
        UInt32 _ChunkSizes 1, 1, 24, 2747;
    }
    AKs {
        String units "meter2 second-1";
        String cell_methods "ocean_time: point";
        String grid "grid";
        String location "face";
        String grid_mapping "projection_stere";
        Float32 _FillValue -32767.0;
        String long_name "Ocean vertical salt diffusivity";
        String standard_name "ocean_vertical_salt_diffusivity";
        String coordinates "lon lat";
        String field "AKs, scalar, series";
        String time "time";
        UInt32 _ChunkSizes 1, 1, 24, 2747;
    }
    Uwind_eastward {
        String long_name "surface u-wind component";
        String units "meter second-1";
        String cell_methods "ocean_time: point";
        String grid "grid";
        String location "face";
        String standard_name "eastward_wind";
        Int16 _FillValue -32767;
        Float32 add_offset 0.0;
        Float32 scale_factor 0.001;
        String coordinates "lon lat";
        String grid_mapping "projection_stere";
        String field "u-wind, scalar, series";
        String time "time";
        UInt32 _ChunkSizes 1, 24, 2747;
    }
    Vwind_northward {
        String long_name "surface v-wind component";
        String units "meter second-1";
        String cell_methods "ocean_time: point";
        String standard_name "northward_wind";
        String grid "grid";
        String location "face";
        Int16 _FillValue -32767;
        Float32 add_offset 0.0;
        Float32 scale_factor 0.001;
        String coordinates "lon lat";
        String grid_mapping "projection_stere";
        String field "v-wind, scalar, series";
        String time "time";
        UInt32 _ChunkSizes 1, 24, 2747;
    }
    NC_GLOBAL {
        String id "ac950cad-8f29-4059-a639-0d3a9b3b9a8d";
        String naming_authority "no.met";
        String operational_status "Operational";
        String iso_topic_category "oceans";
        String activity_type "Numerical Simulation";
        String keywords_vocabulary "GCMDSK:GCMD Science Keywords:https://gcmd.earthdata.nasa.gov/kms/concepts/concept_scheme/sciencekeywords, GEMET:INSPIRE Themes:http://inspire.ec.europa.eu/theme, NORTHEMES:GeoNorge Themes:https://register.geonorge.no/metadata-kodelister/nasjonal-temainndeling";
        String keywords "GCMDSK:EARTH SCIENCE SERVICES > MODELS > OCEAN GENERAL CIRCULATION MODELS (OGCM)/REGIONAL OCEAN MODELS, GCMDSK:Earth Science > Oceans > Ocean Temperature  > WATER TEMPERATURE, GCMDSK:Earth Science > Oceans > Salinity/Density > SALINITY, GCMDSK:Earth Science > Oceans > Ocean Circulation > OCEAN CURRENTS, GCMDSK:Earth Science > Oceans > Sea Ice > SEA ICE CONCENTRATION, GEMET:Oceanographic geographical features, NORTHEMES:Vær og klima, NORTHEMES:Kyst og fiskeri";
        String spatial_representation "grid";
        Float64 geospatial_lat_min 54.29489732781292;
        Float64 geospatial_lat_max 75.72596757645292;
        Float64 geospatial_lon_min -4.614896515529405;
        Float64 geospatial_lon_max 37.55453838195328;
        String time_coverage_start "2026-09-03T00:00:00";
        String time_coverage_end "2026-09-03T23:00:00";
        String Conventions "CF-1.8, ACDD-1.3";
        String source "Numerical Simulation";
        String processing_level "Operational";
        String date_created "2026-08-30T05:59:30.126169Z";
        String creator_type "group";
        String creator_institution "Norwegian Meteorological Institute";
        String creator_name "Division for Ocean and Ice";
        String creator_email "fou-hi@met.no";
        String creator_url "www.met.no";
        String contributor_institution "Norwegian Meteorological Institute, Norwegian Meteorological Institute";
        String institution "Norwegian Meteorological Institute (MET Norway)";
        String publisher_type "institution";
        String publisher_name "Norwegian Meteorological Institute";
        String publisher_institution "Norwegian Meteorological Institute";
        String publisher_email "data-management-group@met.no";
        String publisher_url "https://www.met.no";
        String project "Ocean and Ice - Research to Operation (HI-R2O)";
        String dataset_production_status "In Work";
        String license "https://spdx.org/licenses/CC-BY-4.0 (CC-BY-4.0)";
        String title "Norkyst_v3-800m - ROMS, Norkyst_v3-800m 120 hours ocean forecast, 2026-09-03T00:00:00 - 2026-09-03T23:00:00";
        String summary "Norkyst_v3-800m (Norwegian Coast 800m horizontal resolution) is a numerical, high-resolution, ocean modelling system based on the ROMS model. It has the potential to provide environmental information for all coastal areas in Norway as input to applications regarding oil spills, drift of floating objects (man-over-board), spread of harmful algae and salmon lice etc. See also http://myroms.org";
        String title_no "120 timers prognoser fra havmodellen Norkyst_v3-800m, 2026-09-03T00:00:00 - 2026-09-03T23:00:00";
        String summary_no "NorKyst_v3-800m (Norske kystområder med 800m horisontal oppløsning) er et numerisk høyoppløslig, havmodellerings-system basert på ROMS modellen. Den har potensialet til å produsere miljø-relatert informasjon som dekker alle kystområder i Norge for bruk som driverdata i applikasjoner for overvåkning av oljeutslipp, drift av flytende objekter (mann overbord), spredning av skadelige alger og lakselus osv. Se også http://myroms.org";
        String contributor_name "Magne Simonsen, Mateusz Matuszak";
        String contributor_role "Technical contact, Metadata author";
        String contributor_email "magnes@met.no, mateuszm@met.no";
    }
}
