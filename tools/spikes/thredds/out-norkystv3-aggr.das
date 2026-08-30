Attributes {
    X {
        String units "meter";
        String axis "X";
        String standard_name "projection_x_coordinate";
        UInt32 _ChunkSizes 2747;
    }
    Y {
        String units "meter";
        String axis "Y";
        String standard_name "projection_y_coordinate";
        UInt32 _ChunkSizes 1148;
    }
    depth {
        String long_name "depth";
        String positive "down";
        String axis "Z";
        String standard_name "depth";
        String units "meter";
        UInt32 _ChunkSizes 25;
    }
    h {
        String long_name "sea floor depth below sea level at rest";
        String units "meter";
        String grid "grid";
        String location "face";
        String field "bath, scalar";
        String grid_mapping "projection_stere";
        String coordinates "lon lat";
        String standard_name "sea_floor_depth_below_geopotential_datum";
        String coverage_content_type "referenceInformation";
        UInt32 _ChunkSizes 24, 2747;
    }
    lat {
        String long_name "latitude";
        String field "lat, scalar";
        String units "degree_north";
        String standard_name "latitude";
        UInt32 _ChunkSizes 24, 2747;
    }
    lon {
        String long_name "longitude";
        String field "lon, scalar";
        String units "degree_east";
        String standard_name "longitude";
        UInt32 _ChunkSizes 24, 2747;
    }
    projection_stere {
        String grid_mapping_name "polar_stereographic";
        Float64 straight_vertical_longitude_from_pole 70.0;
        Float64 latitude_of_projection_origin 90.0;
        Float64 standard_parallel 60.0;
        Float64 false_easting 3369600.0;
        Float64 false_northing 1844800.0;
        Float64 semi_major_axis 6378137.0;
        Float64 semi_minor_axis 6356752.3142;
        String proj4 "+proj=stere +lat_0=90 +lat_ts=60 +lon_0=70 +x_0=3369600 +y_0=1844800 +a=6378137 +b=6356752.3142 +units=m +no_defs +type=crs";
    }
    sea_mask {
        String _Unsigned "false";
        String long_name "mask on RHO-points";
        Int16 _FillValue -127;
        String flag_meanings "land water";
        String grid "grid";
        String location "face";
        String coordinates "lon lat";
        String grid_mapping "projection_stere";
        String coverage_content_type "referenceInformation";
        String standard_name "sea_binary_mask";
        String units "1";
        String flag_values "0, 1";
        String flag_meaning "land water";
        UInt32 _ChunkSizes 24, 2747;
    }
    Uwind_eastward {
        String units "meter second-1";
        String grid "grid";
        String location "face";
        String field "u-wind, scalar, series";
        String grid_mapping "projection_stere";
        String coordinates "lon lat";
        Int16 _FillValue -32767;
        Float32 add_offset 0.0;
        Float32 scale_factor 0.01;
        String coverage_content_type "modelResult";
        String standard_name "eastward_wind";
        String long_name "surface u-wind component";
        String time "time";
        UInt32 _ChunkSizes 1, 24, 2747;
    }
    Vwind_northward {
        String units "meter second-1";
        String grid "grid";
        String location "face";
        String field "v-wind, scalar, series";
        String grid_mapping "projection_stere";
        String coordinates "lon lat";
        Int16 _FillValue -32767;
        Float32 add_offset 0.0;
        Float32 scale_factor 0.01;
        String coverage_content_type "modelResult";
        String standard_name "northward_wind";
        String long_name "surface v-wind component";
        String time "time";
        UInt32 _ChunkSizes 1, 24, 2747;
    }
    ln_AKs {
        String units "meter2 second-1";
        String grid "grid";
        String location "face";
        String field "AKs, scalar, series";
        String grid_mapping "projection_stere";
        String coordinates "lon lat";
        Int16 _FillValue -32767;
        Float32 add_offset 0.0;
        Float32 scale_factor 0.001;
        String standard_name "ln_ocean_vertical_salt_diffusivity";
        String coverage_content_type "modelResult";
        String long_name "Natural logarithm of Ocean vertical salt diffusivity";
        String time "time";
        UInt32 _ChunkSizes 1, 1, 24, 2747;
    }
    salinity {
        String grid "grid";
        String location "face";
        String field "salinity, scalar, series";
        String grid_mapping "projection_stere";
        String coordinates "lon lat";
        Int16 _FillValue -32767;
        Float32 add_offset 30.0;
        Float32 scale_factor 0.001;
        String long_name "Sea water salinity";
        String standard_name "sea_water_salinity";
        String coverage_content_type "modelResult";
        String units "1";
        String time "time";
        UInt32 _ChunkSizes 1, 1, 24, 2747;
    }
    temperature {
        String units "Celsius";
        String grid "grid";
        String location "face";
        String field "temperature, scalar, series";
        String grid_mapping "projection_stere";
        String coordinates "lon lat";
        Int16 _FillValue -32767;
        Float32 add_offset 10.0;
        Float32 scale_factor 0.001;
        String long_name "Sea water potential temperature";
        String standard_name "sea_water_potential_temperature";
        String coverage_content_type "modelResult";
        String time "time";
        UInt32 _ChunkSizes 1, 1, 24, 2747;
    }
    time {
        String long_name "time since initialization";
        String units "seconds since 1970-01-01 00:00:00";
        String field "time, scalar, series";
        String axis "T";
        String standard_name "time";
        String calendar "gregorian";
        UInt32 _ChunkSizes 1;
    }
    u_eastward {
        String units "meter second-1";
        String grid "grid";
        String field "u-velocity, scalar, series";
        String grid_mapping "projection_stere";
        String coordinates "lon lat";
        Int16 _FillValue -32767;
        Float32 add_offset 0.0;
        Float32 scale_factor 0.001;
        String long_name "Sea water eastward velocity";
        String coverage_content_type "modelResult";
        String standard_name "eastward_sea_water_velocity";
        String location "face";
        String time "time";
        UInt32 _ChunkSizes 1, 1, 24, 2747;
    }
    v_northward {
        String units "meter second-1";
        String grid "grid";
        String field "v-velocity, scalar, series";
        String grid_mapping "projection_stere";
        String coordinates "lon lat";
        Int16 _FillValue -32767;
        Float32 add_offset 0.0;
        Float32 scale_factor 0.001;
        String long_name "Sea water northward velocity";
        String coverage_content_type "modelResult";
        String standard_name "northward_sea_water_velocity";
        String location "face";
        String time "time";
        UInt32 _ChunkSizes 1, 1, 24, 2747;
    }
    zeta {
        String units "meter";
        String grid "grid";
        String location "face";
        String field "free-surface, scalar, series";
        String grid_mapping "projection_stere";
        Int16 _FillValue -32767;
        Float32 add_offset 0.0;
        Float32 scale_factor 0.01;
        String coordinates "lon lat";
        String long_name "free surface elevation with respect to sea level at rest";
        String standard_name "sea_surface_height_above_geopotential_datum";
        String coverage_content_type "modelResult";
        String time "time";
        UInt32 _ChunkSizes 1, 24, 2747;
    }
    NC_GLOBAL {
        String id "87713e2b-6cff-4556-acf3-6a090c8cf2d3";
        String naming_authority "no.met";
        String operational_status "scientific";
        String iso_topic_category "oceans";
        String activity_type "Numerical Simulation";
        String keywords_vocabulary "GCMDSK:GCMD Science Keywords:https://gcmd.earthdata.nasa.gov/kms/concepts/concept_scheme/sciencekeywords, GEMET:INSPIRE Themes:http://inspire.ec.europa.eu/theme, NORTHEMES:GeoNorge Themes:https://register.geonorge.no/metadata-kodelister/nasjonal-temainndeling";
        String keywords "GCMDSK:EARTH SCIENCE SERVICES > MODELS > OCEAN GENERAL CIRCULATIONMODELS (OGCM)/REGIONAL OCEAN MODELS, GCMDSK:Earth Science > Oceans > Ocean Temperature  > WATER TEMPERATURE, GCMDSK:Earth Science > Oceans > Salinity/Density > SALINITY, GCMDSK:Earth Science > Oceans > Ocean Circulation > OCEAN CURRENTS, GCMDSK:Earth Science > Oceans > Sea Ice > SEA ICE CONCENTRATION, GEMET:Oceanographic geographical features, NORTHEMES:Vær og klima, NORTHEMES:Kyst og fiskeri";
        String spatial_representation "grid";
        Float64 geospatial_lat_min 54.294897327964655;
        Float64 geospatial_lat_max 75.72596757655101;
        Float64 geospatial_lon_min -4.614896515529405;
        Float64 geospatial_lon_max 37.55453838195327;
        String time_coverage_start "2025-08-01T00:00:00";
        String time_coverage_end "2025-08-01T23:00:00";
        String Conventions "CF-1.8, ACDD-1.3";
        String source "Numerical Simulation";
        String processing_level "Processed";
        String date_created "2025-09-12T19:25:19.943547Z";
        String creator_type "institution";
        String creator_institution "Norwegian Meteorological Institute (MET Norway); Institute of Marine Research (IMR)";
        String creator_email "ocean@met.no";
        String creator_url "www.met.no; www.hi.no";
        String publisher_type "institution";
        String publisher_name "Norwegian Meteorological Institute";
        String publisher_institution "Norwegian Meteorological Institute";
        String publisher_email "data-management-group@met.no";
        String publisher_url "https://www.met.no";
        String project "Norkyst_v3";
        String license "https://spdx.org/licenses/CC-BY-4.0 (CC-BY-4.0)";
        String title "Norkyst-800m - ROMS, Norkyst-800m ocean hindcast, 2025-08-01T00:00:00 - 2025-08-01T23:00:00";
        String summary "Norkyst-800m (Norwegian Coast 800m horizontal resolution) is a numerical, high-resolution, ocean modelling system based on the ROMS model. It has the potential to provide environmental information for all coastal areas in Norway as input to applications regarding oil spills, drift of floating objects (man-over-board), spread of harmful algae and salmon lice etc. See also http://myroms.org";
        String title_no "Hindcast prognoser fra havmodellen Norkyst-800m, 2025-08-01T00:00:00 - 2025-08-01T23:00:00";
        String summary_no "NorKyst-800m (Norske kystområder med 800m horisontal oppløsning) er et numerisk høyoppløslig, havmodellerings-system basert på ROMS modellen. Den har potensialet til å produsere miljø-relatert informasjon som dekker alle kystområder i Norge for bruk som driverdata i applikasjoner for overvåkning av oljeutslipp, drift av flytende objekter (mann overbord), spredning av skadelige alger og lakselus osv. Se også http://myroms.org";
    }
}
